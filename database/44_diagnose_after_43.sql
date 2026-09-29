-- ══════════════════════════════════════════════════════════════════
-- ترقية 44: تشخيص موسّع بعد ما ترقية 43 طلعت 0 مشاكل - نتأكد من حاجتين:
--   (أ) هل إحنا فعلاً متوصلين بنفس السيرفر/القاعدة اللي الموقع شغّال
--       عليها؟ (نفس فكرة سكريبت 41 القديم)
--   (ب) هل فيه تراخيص "متصفي" بس شهر/سنة/تاريخ التصفية التلاتة فاضيين
--       مع بعض (مش بس التاريخ لوحده زي ما افترضنا في ترقية 43)؟
--
-- معاينة فقط بالكامل - مفيش أي تعديل على القاعدة في السكريبت ده.
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- (1) تأكيد هوية السيرفر/القاعدة اللي الاسكريبت شغال عليها دلوقتي
SELECT
  @@SERVERNAME        AS ServerName,
  DB_NAME()           AS CurrentDatabase,
  (SELECT COUNT(*) FROM FundraisingLicenses WHERE ISNULL(IsDeleted,0)=0) AS TotalLicenses,
  (SELECT COUNT(*) FROM FundraisingLicenses WHERE ISNULL(IsDeleted,0)=0 AND LicenseStatus=N'متصفي') AS TotalMarkedLiquidated;
GO

-- (2) من التراخيص "متصفي" - وزّعيها حسب حالة أعمدة التصفية التلاتة
SELECT
  CASE
    WHEN LiquidationDate IS NOT NULL THEN N'تاريخ التصفية موجود (سليم)'
    WHEN LiquidationMonth IS NOT NULL AND LiquidationYear IS NOT NULL THEN N'شهر/سنة موجودين بس التاريخ فاضي'
    WHEN LiquidationYear IS NOT NULL THEN N'سنة بس من غير شهر ولا تاريخ'
    ELSE N'التلاتة فاضيين خالص (شهر/سنة/تاريخ)'
  END AS Situation,
  COUNT(*) AS Count,
  SUM(Revenue) AS TotalRevenue,
  SUM(ISNULL(NetAmount,0)) AS TotalNet
FROM FundraisingLicenses
WHERE ISNULL(IsDeleted,0) = 0
  AND LicenseStatus = N'متصفي'
GROUP BY
  CASE
    WHEN LiquidationDate IS NOT NULL THEN N'تاريخ التصفية موجود (سليم)'
    WHEN LiquidationMonth IS NOT NULL AND LiquidationYear IS NOT NULL THEN N'شهر/سنة موجودين بس التاريخ فاضي'
    WHEN LiquidationYear IS NOT NULL THEN N'سنة بس من غير شهر ولا تاريخ'
    ELSE N'التلاتة فاضيين خالص (شهر/سنة/تاريخ)'
  END;
GO

-- (3) عيّنة فعلية (أول 15 سجل) من التراخيص "متصفي" اللي شهر/سنة/تاريخ
-- التصفية عندها فاضيين خالص - عشان نشوف بيانات حقيقية بعنينا
SELECT TOP 15
  f.LicID, o.OrgName, f.LicenseNumber, f.IssueYear,
  f.LicenseStatus, f.StartDate, f.EndDate,
  f.LiquidationDate, f.LiquidationMonth, f.LiquidationYear,
  f.Revenue, f.Expenses, f.NetAmount, f.LiquidationStatus
FROM FundraisingLicenses f
JOIN Organizations o ON f.OrgID = o.OrgID
WHERE ISNULL(f.IsDeleted,0) = 0
  AND f.LicenseStatus = N'متصفي'
  AND f.LiquidationDate IS NULL
  AND f.LiquidationMonth IS NULL
  AND f.LiquidationYear IS NULL
ORDER BY o.OrgName;
GO

-- (4) خاص بنادي هيئة تدريس جامعة الأزهر (رقم ترخيص 171) - نفس المثال
-- اللي ظاهر في لقطة الشاشة الأصلية - نشوف حالته بالظبط دلوقتي
SELECT f.LicID, o.OrgName, f.LicenseNumber, f.IssueYear, f.LicenseStatus,
  f.StartDate, f.EndDate, f.LiquidationDate, f.LiquidationMonth, f.LiquidationYear,
  f.Revenue, f.Expenses, f.NetAmount
FROM FundraisingLicenses f
JOIN Organizations o ON f.OrgID = o.OrgID
WHERE f.LicenseNumber = N'171' AND ISNULL(f.IsDeleted,0) = 0;
GO
