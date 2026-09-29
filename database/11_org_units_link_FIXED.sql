-- ══════════════════════════════════════════════════
-- ترقية 11 (نسخة مصححة): نقل "إدارة المنظمات" لتصبح مثل باقي الإدارات
-- كل تسجيل الآن مرتبط بجمعية محددة (OrgID) عبر بيانات ثابتة/مستندات/أسئلة إلزامية
-- + دعم أكثر من منظمة تحت نفس الجمعية في نفس التسجيل (جدول OrgUnits جديد)
--
-- 🔧 التصحيح: الأعمدة OrgCount / LicenseRenewed / LicenseAmended اتعرّفت في سكريبت 09
-- بـ DEFAULT ضمني، فسيرفر SQL بيعمل لها قيد افتراضي (Default Constraint) باسم تلقائي.
-- SQL Server مبيسمحش تحذف عمود عليه قيد افتراضي قبل ما تحذف القيد نفسه أولاً.
-- الإصلاح هنا: نلاقي اسم القيد التلقائي من sys.default_constraints ونحذفه ديناميكياً
-- قبل حذف كل عمود. باقي السكريبت زي ما هو بالظبط، وآمن إعادة تشغيله من الصفر
-- (كل خطوة فيه بتتأكد الأول إن التغيير مطبّق قبل ما تنفّذه).
-- ══════════════════════════════════════════════════
USE NGO_System;
GO

-- ── حذف الجداول القديمة غير المرتبطة بجمعية محددة (لا تحوي بيانات حقيقية بعد) ──
IF OBJECT_ID('OrgGeneralActivities','U') IS NOT NULL DROP TABLE OrgGeneralActivities;
GO
IF OBJECT_ID('OrgGeneralPurposes','U') IS NOT NULL DROP TABLE OrgGeneralPurposes;
GO
IF OBJECT_ID('OrgGeneralNationalities','U') IS NOT NULL DROP TABLE OrgGeneralNationalities;
GO

-- ── ربط كل "واقعة/دفعة" بجمعية محددة ──
IF COL_LENGTH('OrgGeneralEntries','OrgID') IS NULL
BEGIN
    ALTER TABLE OrgGeneralEntries ADD OrgID INT NULL REFERENCES Organizations(OrgID);
END
GO

-- ── حذف الحقول اللي بقت خاصة بكل منظمة على حدة بدل الدفعة كلها ──
-- (بندي القيد الافتراضي التلقائي أولاً لكل عمود، ثم نحذف العمود نفسه)
IF COL_LENGTH('OrgGeneralEntries','OrgCount') IS NOT NULL
BEGIN
    DECLARE @cname1 NVARCHAR(200);
    SELECT @cname1 = dc.name FROM sys.default_constraints dc
        JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        WHERE dc.parent_object_id = OBJECT_ID('OrgGeneralEntries') AND c.name = 'OrgCount';
    IF @cname1 IS NOT NULL
        EXEC('ALTER TABLE OrgGeneralEntries DROP CONSTRAINT [' + @cname1 + ']');
    ALTER TABLE OrgGeneralEntries DROP COLUMN OrgCount;
END
GO
IF COL_LENGTH('OrgGeneralEntries','LicenseRenewed') IS NOT NULL
BEGIN
    DECLARE @cname2 NVARCHAR(200);
    SELECT @cname2 = dc.name FROM sys.default_constraints dc
        JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        WHERE dc.parent_object_id = OBJECT_ID('OrgGeneralEntries') AND c.name = 'LicenseRenewed';
    IF @cname2 IS NOT NULL
        EXEC('ALTER TABLE OrgGeneralEntries DROP CONSTRAINT [' + @cname2 + ']');
    ALTER TABLE OrgGeneralEntries DROP COLUMN LicenseRenewed;
END
GO
IF COL_LENGTH('OrgGeneralEntries','LicenseAmended') IS NOT NULL
BEGIN
    DECLARE @cname3 NVARCHAR(200);
    SELECT @cname3 = dc.name FROM sys.default_constraints dc
        JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        WHERE dc.parent_object_id = OBJECT_ID('OrgGeneralEntries') AND c.name = 'LicenseAmended';
    IF @cname3 IS NOT NULL
        EXEC('ALTER TABLE OrgGeneralEntries DROP CONSTRAINT [' + @cname3 + ']');
    ALTER TABLE OrgGeneralEntries DROP COLUMN LicenseAmended;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_OrgGeneralEntries_OrgID' AND object_id=OBJECT_ID('OrgGeneralEntries'))
    CREATE INDEX IX_OrgGeneralEntries_OrgID ON OrgGeneralEntries(OrgID);
GO

-- ── جدول المنظمات الفردية: كل صف = منظمة باسمها الخاص تحت نفس الجمعية ونفس التسجيل ──
IF OBJECT_ID('OrgUnits','U') IS NULL
BEGIN
    CREATE TABLE OrgUnits (
        UnitID INT IDENTITY(1,1) PRIMARY KEY,
        OrgEntryID INT NOT NULL REFERENCES OrgGeneralEntries(OrgEntryID) ON DELETE CASCADE,
        UnitName NVARCHAR(500) NOT NULL,           -- اسم المنظمة الخاصة
        Nationality NVARCHAR(200),                  -- جنسية هذه المنظمة تحديدًا
        Purpose NVARCHAR(500),                      -- الغرض الخاص بهذه المنظمة
        LicenseRenewed BIT DEFAULT 0,                -- تم تجديد تصريح هذه المنظمة تحديدًا
        LicenseAmended BIT DEFAULT 0,                -- تم تعديل تصريح هذه المنظمة تحديدًا
        Notes NVARCHAR(1000),
        IsActive BIT DEFAULT 1,
        CreatedAt DATETIME DEFAULT GETDATE()
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_OrgUnits_Entry' AND object_id=OBJECT_ID('OrgUnits'))
    CREATE INDEX IX_OrgUnits_Entry ON OrgUnits(OrgEntryID);
GO

-- ── أنشطة كل منظمة على حدة (اختيار متعدد لكل منظمة) ──
IF OBJECT_ID('OrgUnitActivities','U') IS NULL
BEGIN
    CREATE TABLE OrgUnitActivities (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        UnitID INT NOT NULL REFERENCES OrgUnits(UnitID) ON DELETE CASCADE,
        ActivityName NVARCHAR(500) NOT NULL
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_OrgUnitActivities_Unit' AND object_id=OBJECT_ID('OrgUnitActivities'))
    CREATE INDEX IX_OrgUnitActivities_Unit ON OrgUnitActivities(UnitID);
GO

-- ── سؤال إلزامي خاص بإدارة المنظمات (كباقي الإدارات - يظهر ضمن خطوة الأسئلة الإلزامية) ──
IF NOT EXISTS (SELECT 1 FROM MandatoryQuestions WHERE Department=N'المنظمات')
BEGIN
    INSERT INTO MandatoryQuestions (QuestionText, Department, QuestionType, AddedBy) VALUES
    (N'هل يوجد منظمات مسجلة تحت هذه الجمعية؟', N'المنظمات', N'yesno', 1);
END
GO

PRINT N'✅ تم نقل إدارة المنظمات لتعمل مثل باقي الإدارات (مرتبطة بجمعية + تدعم أكثر من منظمة باسمها الخاص لكل جمعية)';
GO
