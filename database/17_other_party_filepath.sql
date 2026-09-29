-- ══════════════════════════════════════════════════
-- ترقية: إضافة عمود مستند الحدث (FilePath) لجدول OtherPartyEvents
-- بنفس فكرة 14_event_document.sql لكن لجدول أحداث "الجهات الأخرى"
-- يسمح برفع/استبدال مستند الحدث في أي وقت من نافذة "تعديل الحدث"
-- آمنة للتشغيل أكثر من مرة (تتحقق من وجود العمود قبل الإضافة)
-- ══════════════════════════════════════════════════
USE NGO_System;
GO

IF OBJECT_ID('OtherPartyEvents','U') IS NOT NULL
BEGIN
  IF COL_LENGTH('OtherPartyEvents','FilePath') IS NULL
    ALTER TABLE OtherPartyEvents ADD FilePath NVARCHAR(1000) NULL;
END
GO

PRINT N'✅ تم إضافة عمود مستند الحدث (FilePath) إلى جدول OtherPartyEvents بنجاح';
GO
