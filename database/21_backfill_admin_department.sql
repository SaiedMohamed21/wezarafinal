-- ══════════════════════════════════════════════════════════════════════
-- سبب هذه الترقية:
-- ترقية 20 أضافت عمود Department (وCreatedBy) لجداول Grants/Projects/
-- Legislations/BannedOrgs/FundraisingLicenses عشان نظام الصلاحيات
-- (assertCanManageDeptRecord في server_v5.js) يقدر يتأكد إن الموظف بيعدّل/
-- يحذف بس بيانات إدارته هو. لكن كل السجلات اللي كانت موجودة بالفعل قبل هذه
-- الترقية (وأي سجلات اتسجلت بعدها لحد ما تم إصلاح كود الواجهة اللي كان
-- بينسى يبعت Department عند الإنشاء) اتسجلت بعمود Department = NULL.
--
-- ده كان بيخلي أي موظف عادي (غير المدير العام) يقدر يشوف بياناته بس
-- مايقدرش يعدّلها أو يحذفها - يظهر له خطأ "سجل قديم غير مرتبط بإدارة
-- محددة - التعديل/الحذف مقصور على المدير العام" حتى لو هو نفسه اللي سجّلها.
--
-- هذه الترقية تسترجع الإدارة الصحيحة لكل سجل قديم من عمود CreatedBy
-- (بربطه بجدول Users) وتملأ عمود Department بيها بأثر رجعي. أي سجل مالوش
-- CreatedBy معروف (بيانات قديمة جدًا اتسجلت قبل وجود العمود أصلاً) هيفضل
-- Department فيه NULL - وده متوقع، ونظام الصلاحيات المُعدَّل حاليًا بيسمح
-- بره كده لصاحب السجل الأصلي (CreatedBy) بالتعديل حتى لو مفيش Department.
-- ══════════════════════════════════════════════════════════════════════

-- Grants
UPDATE g SET g.Department = u.Department
FROM Grants g
JOIN Users u ON u.UserID = g.CreatedBy
WHERE g.Department IS NULL AND g.CreatedBy IS NOT NULL AND u.Department IS NOT NULL;

-- Projects
UPDATE p SET p.Department = u.Department
FROM Projects p
JOIN Users u ON u.UserID = p.CreatedBy
WHERE p.Department IS NULL AND p.CreatedBy IS NOT NULL AND u.Department IS NOT NULL;

-- Legislations
UPDATE l SET l.Department = u.Department
FROM Legislations l
JOIN Users u ON u.UserID = l.CreatedBy
WHERE l.Department IS NULL AND l.CreatedBy IS NOT NULL AND u.Department IS NOT NULL;

-- BannedOrgs
UPDATE b SET b.Department = u.Department
FROM BannedOrgs b
JOIN Users u ON u.UserID = b.CreatedBy
WHERE b.Department IS NULL AND b.CreatedBy IS NOT NULL AND u.Department IS NOT NULL;

-- FundraisingLicenses
UPDATE fl SET fl.Department = u.Department
FROM FundraisingLicenses fl
JOIN Users u ON u.UserID = fl.CreatedBy
WHERE fl.Department IS NULL AND fl.CreatedBy IS NOT NULL AND u.Department IS NOT NULL;

-- تقرير سريع بعد التنفيذ: كام سجل لسه Department = NULL في كل جدول
-- (دول اللي مالهمش CreatedBy معروف - هيفضلوا قابلين للتعديل من صاحبهم الأصلي فقط لو عُرف لاحقًا،
--  أو من المدير العام)
SELECT 'Grants' AS TableName, COUNT(*) AS StillNullDepartment FROM Grants WHERE Department IS NULL
UNION ALL
SELECT 'Projects', COUNT(*) FROM Projects WHERE Department IS NULL
UNION ALL
SELECT 'Legislations', COUNT(*) FROM Legislations WHERE Department IS NULL
UNION ALL
SELECT 'BannedOrgs', COUNT(*) FROM BannedOrgs WHERE Department IS NULL
UNION ALL
SELECT 'FundraisingLicenses', COUNT(*) FROM FundraisingLicenses WHERE Department IS NULL;
GO
