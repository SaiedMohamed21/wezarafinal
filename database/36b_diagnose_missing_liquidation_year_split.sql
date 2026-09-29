-- ══════════════════════════════════════════════════════════════════
-- تشخيص 36ب: نفس الـ305 ترخيص "متصفي" من غير سنة تصفية - بس مقسّمة
-- حسب هل عندها EndDate (تاريخ نهاية الترخيص) نقدر نستخدمه كتقدير
-- لسنة/تاريخ التصفية، ولا لأ (زي الصفين الأولانيين في لقطة الشاشة
-- اللي StartDate/EndDate كمان NULL عندهم).
-- معاينة فقط - من غير أي تعديل على القاعدة.
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- (1) ملخص عددي بس
SELECT
  SUM(CASE WHEN f.EndDate IS NOT NULL THEN 1 ELSE 0 END)  AS HasEndDate_CanEstimate,
  SUM(CASE WHEN f.EndDate IS NULL THEN 1 ELSE 0 END)      AS NoEndDate_NeedsManualReview,
  COUNT(*)                                                 AS Total
FROM FundraisingLicenses f
WHERE ISNULL(f.IsDeleted,0) = 0
  AND f.LicenseStatus = N'متصفي'
  AND f.LiquidationYear IS NULL;
GO

-- (2) المجموعة التانية بس: اللي مالهاش حتى EndDate - دول محتاجين مراجعة
-- يدوية لأن مفيش أي عمود تاريخ تانِ نقدر نستنتج منه سنة التصفية
SELECT
  f.LicID, o.OrgName, f.LicenseNumber, f.IssueYear, f.StartDate, f.EndDate
FROM FundraisingLicenses f
JOIN Organizations o ON f.OrgID = o.OrgID
WHERE ISNULL(f.IsDeleted,0) = 0
  AND f.LicenseStatus = N'متصفي'
  AND f.LiquidationYear IS NULL
  AND f.EndDate IS NULL
ORDER BY o.OrgName;
GO
