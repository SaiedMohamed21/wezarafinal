-- ══════════════════════════════════════════════════
-- ترقية: إضافة عمود "الجهة المرسلة" (SenderName) لجدول أحداث الجمعيات (OrgEvents)
-- نفس فكرة عمود SenderName الموجود بالفعل في جدول OtherPartyEvents، لكن هنا
-- بيسمح بتسجيل اسم الجهة المرسلة لأي "آخر حدث" خاص بجمعية مسجَّلة بالفعل،
-- ويكون قابل للتعديل من نافذة "تعديل الحدث"، وداخل في البحث الشامل بالموقع.
-- آمنة للتشغيل أكثر من مرة (تتحقق من وجود العمود قبل الإضافة)
-- ══════════════════════════════════════════════════
USE NGO_System;
GO

IF COL_LENGTH('OrgEvents','SenderName') IS NULL
  ALTER TABLE OrgEvents ADD SenderName NVARCHAR(500) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_OrgEvents_SenderName')
  CREATE INDEX IX_OrgEvents_SenderName ON OrgEvents(SenderName);
GO

PRINT N'✅ تم إضافة عمود الجهة المرسلة (SenderName) إلى جدول OrgEvents بنجاح';
GO
