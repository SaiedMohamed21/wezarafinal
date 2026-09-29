-- ══════════════════════════════════════════════════════════════════
-- 32_director_suspend_flag.sql
-- ميزة "حالة الجمعية من المدير" - علامة منفصلة تمامًا عن عمود الحالة
-- الرسمي (Status) بتاع الجمعية، يضيفها المدير العام بس، ومن "نشطة"
-- إلى "موقوفة" فقط - لا تغيّر عمود Status الرسمي أبدًا (ده لسه حصريًا
-- بيد إدارة التشريعات/القيد زي ما هو تمامًا).
-- ══════════════════════════════════════════════════════════════════

IF COL_LENGTH('Organizations','DirFlagSuspended') IS NULL
  ALTER TABLE Organizations ADD DirFlagSuspended BIT NOT NULL DEFAULT 0;
GO

IF COL_LENGTH('Organizations','DirFlagNote') IS NULL
  ALTER TABLE Organizations ADD DirFlagNote NVARCHAR(500) NULL;
GO

IF COL_LENGTH('Organizations','DirFlagBy') IS NULL
  ALTER TABLE Organizations ADD DirFlagBy INT NULL;
GO

IF COL_LENGTH('Organizations','DirFlagAt') IS NULL
  ALTER TABLE Organizations ADD DirFlagAt DATETIME NULL;
GO

-- سجل تاريخي بسيط لكل مرة المدير حط/شال العلامة دي - عشان لو حصل خلاف
-- او احتجنا نراجع مين عمل ايه وامتى (مش شرط للعرض، بس مفيد للتوثيق).
IF OBJECT_ID('DirectorFlagLog','U') IS NULL
CREATE TABLE DirectorFlagLog (
    LogID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    Action NVARCHAR(20) NOT NULL,      -- 'set' أو 'clear'
    Note NVARCHAR(500) NULL,
    ByUser INT NULL,
    StatusAtTime NVARCHAR(100) NULL,   -- عمود الحالة الرسمي وقت الإجراء (للتوثيق فقط)
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE INDEX IX_Org_DirFlag ON Organizations(DirFlagSuspended);
GO
