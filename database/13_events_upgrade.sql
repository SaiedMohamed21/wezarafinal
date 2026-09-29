-- ══════════════════════════════════════════════════
-- ترقية جداول "آخر حدث": القيد الكامل (وارد/صادر/إجراءات/حالة/هام/عاجل)
-- تُطبَّق على: أحداث الجمعيات (OrgEvents) وأحداث الجهات الأخرى (OtherPartyEvents)
-- آمنة للتشغيل أكثر من مرة (تتحقق من وجود العمود قبل الإضافة)
-- ══════════════════════════════════════════════════
USE NGO_System;
GO

-- ── OrgEvents: إضافة رقم/تاريخ الوارد، المستلم، الإجراءات (JSON)، الحالة، هام/عاجل ──
IF COL_LENGTH('OrgEvents','IncomingNum') IS NULL
  ALTER TABLE OrgEvents ADD IncomingNum NVARCHAR(100) NULL;
GO
IF COL_LENGTH('OrgEvents','IncomingDate') IS NULL
  ALTER TABLE OrgEvents ADD IncomingDate DATE NULL;
GO
IF COL_LENGTH('OrgEvents','Receiver') IS NULL
  ALTER TABLE OrgEvents ADD Receiver NVARCHAR(200) NULL;
GO
IF COL_LENGTH('OrgEvents','Actions') IS NULL
  ALTER TABLE OrgEvents ADD Actions NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('OrgEvents','Status') IS NULL
  ALTER TABLE OrgEvents ADD Status NVARCHAR(50) NOT NULL DEFAULT N'جاري العمل';
GO
IF COL_LENGTH('OrgEvents','IsImportant') IS NULL
  ALTER TABLE OrgEvents ADD IsImportant BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('OrgEvents','IsUrgent') IS NULL
  ALTER TABLE OrgEvents ADD IsUrgent BIT NOT NULL DEFAULT 0;
GO

-- ── OtherPartyEvents: الجدول ده أصلاً بيتعمل تلقائياً بالسيرفر لو مش موجود،
--    فهنا بس بنضيف الأعمدة الناقصة (هام/عاجل) لو الجدول كان موجود من قبل بدونها ──
IF OBJECT_ID('OtherPartyEvents','U') IS NOT NULL
BEGIN
  IF COL_LENGTH('OtherPartyEvents','IsImportant') IS NULL
    ALTER TABLE OtherPartyEvents ADD IsImportant BIT NOT NULL DEFAULT 0;
  IF COL_LENGTH('OtherPartyEvents','IsUrgent') IS NULL
    ALTER TABLE OtherPartyEvents ADD IsUrgent BIT NOT NULL DEFAULT 0;
END
ELSE
BEGIN
  CREATE TABLE OtherPartyEvents(
    EventID INT IDENTITY(1,1) PRIMARY KEY,
    SenderName NVARCHAR(500), IncomingNum NVARCHAR(100), IncomingDate DATE,
    EventType NVARCHAR(100), Subject NVARCHAR(1000), Receiver NVARCHAR(200),
    Department NVARCHAR(100), Status NVARCHAR(50) DEFAULT N'جاري العمل',
    Actions NVARCHAR(MAX), RecordedBy NVARCHAR(200), RecordedDept NVARCHAR(100),
    IsImportant BIT NOT NULL DEFAULT 0, IsUrgent BIT NOT NULL DEFAULT 0,
    CreatedAt DATETIME DEFAULT GETDATE());
END
GO

CREATE INDEX IX_OrgEvents_IncomingNum ON OrgEvents(IncomingNum);
GO
CREATE INDEX IX_OrgEvents_Status ON OrgEvents(Status);
GO

PRINT N'✅ تم ترقية جداول الأحداث (وارد/صادر/إجراءات/حالة/هام/عاجل) بنجاح';
GO
