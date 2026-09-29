-- ══════════════════════════════════════════════════
-- ترقية 05: دعم تدفق "طلب إضافة جمعية" الكامل
-- (بيانات إدارية + مستندات مرفوعة + الإدارة صاحبة الطلب)
-- ══════════════════════════════════════════════════
USE NGO_System;
GO

IF COL_LENGTH('AddRequests','Department') IS NULL
    ALTER TABLE AddRequests ADD Department NVARCHAR(100) NULL;
GO
IF COL_LENGTH('AddRequests','AdminData') IS NULL
    ALTER TABLE AddRequests ADD AdminData NVARCHAR(MAX) NULL;   -- JSON بالبيانات الإدارية الخاصة بإدارة مقدّم الطلب
GO
IF COL_LENGTH('AddRequests','DocFilePath') IS NULL
    ALTER TABLE AddRequests ADD DocFilePath NVARCHAR(1000) NULL; -- مسار/مسارات المستندات المرفوعة (مفصولة بفاصلة)
GO

PRINT N'✅ تم تحديث جدول AddRequests ليدعم البيانات الإدارية والمستندات';
GO
