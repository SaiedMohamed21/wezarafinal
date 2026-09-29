-- ══════════════════════════════════════════════════════════════════════════
-- ترقية 37: إضافة أعمدة الحذف الناعم (Soft Delete) + FilePath لجدول OtherPartyEvents
-- المشكلة: الترقية 20 أضافت IsDeleted لكل الجداول ما عدا OtherPartyEvents،
--          وكمان FilePath من الترقية 17 ممكن تكون ما اتطبّقتش.
-- ده بيسبب خطأ "Invalid column name 'IsDeleted'" عند التعديل أو البحث.
-- آمنة للتنفيذ أكثر من مرة (بتتحقق إن العمود مش موجود قبل ما تضيفه)
-- ══════════════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- ── FilePath: مسار مستند الحدث (PDF/Word) ──────────────────────────────
IF COL_LENGTH('OtherPartyEvents','FilePath') IS NULL
    ALTER TABLE OtherPartyEvents ADD FilePath NVARCHAR(1000) NULL;
GO

-- ── IsDeleted + أعمدة الحذف بسبب (Soft Delete + Audit) ──────────────────
IF COL_LENGTH('OtherPartyEvents','IsDeleted') IS NULL
    ALTER TABLE OtherPartyEvents ADD IsDeleted BIT NOT NULL DEFAULT 0;
GO

IF COL_LENGTH('OtherPartyEvents','DeleteReason') IS NULL
    ALTER TABLE OtherPartyEvents ADD DeleteReason NVARCHAR(500) NULL;
GO

IF COL_LENGTH('OtherPartyEvents','DeletedBy') IS NULL
    ALTER TABLE OtherPartyEvents ADD DeletedBy NVARCHAR(200) NULL;
GO

IF COL_LENGTH('OtherPartyEvents','DeletedAt') IS NULL
    ALTER TABLE OtherPartyEvents ADD DeletedAt DATETIME NULL;
GO

PRINT N'✅ تم إضافة FilePath + IsDeleted + DeleteReason + DeletedBy + DeletedAt إلى OtherPartyEvents بنجاح';
GO
