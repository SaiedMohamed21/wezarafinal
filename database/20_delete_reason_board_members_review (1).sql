-- ══════════════════════════════════════════════════════════════════════════
-- ترقية 20: أزرار الحذف/التعديل بسبب + جدول أعضاء مجلس الإدارة
--           + دعم مراجعة الطلبات المكررة/المرتبطة بحدث لجمعية موجودة
-- ══════════════════════════════════════════════════════════════════════════
-- آمن للتنفيذ أكثر من مرة (كل أمر بيتحقق الأول إن التغيير مش موجود قبل ما ينفذه)
-- ولا يحذف ولا يغيّر أي بيانات موجودة حاليًا - إضافات فقط (Additive Only)
-- ══════════════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 1: أعمدة "الحذف بسبب" (Soft Delete + Audit) على كل الجداول اللي
--   المفروض يظهر جنبها زر حذف في نتائج البحث.
--   السبب في إننا مش بنعمل DELETE فعلي: عشان تفضل قابلة للمراجعة لاحقًا
--   (مين حذف، إمتى، وليه) - ده الأسلوب الآمن والمعمول به في الأنظمة الرسمية.
--   أي شاشة/تقرير موجود دلوقتي هيفضل شغال زي ما هو بالظبط، لأننا هنضيف
--   شرط "IsDeleted=0" بس على الاستعلامات اللي بتُعرض للمستخدم (في السيرفر).
-- ─────────────────────────────────────────────────────────────────────────

-- Organizations (حذف الجمعية بالكامل - صلاحية مدير فقط في الواجهة)
-- ملحوظة: الجدول ده أصلاً فيه عمود IsActive بيُستخدم كـ "حذف ناعم" في كل
-- الاستعلامات الحالية (WHERE IsActive=1) - فمش هنضيف عمود IsDeleted تاني
-- عشانه، هنستخدم IsActive=0 عند الحذف، ونضيف بس أعمدة سبب/تاريخ الحذف.
IF COL_LENGTH('Organizations','DeleteReason') IS NULL
    ALTER TABLE Organizations ADD DeleteReason NVARCHAR(500) NULL;
GO
IF COL_LENGTH('Organizations','DeletedBy') IS NULL
    ALTER TABLE Organizations ADD DeletedBy INT NULL;
GO
IF COL_LENGTH('Organizations','DeletedAt') IS NULL
    ALTER TABLE Organizations ADD DeletedAt DATETIME NULL;
GO

-- FundraisingLicenses (بيانات جمع المال - تبقى موجودة زي ما هي، بس بنضيف
-- إمكانية حذف ترخيص واحد بسبب لو احتاج حد يمسح سجل غلط)
IF COL_LENGTH('FundraisingLicenses','IsDeleted') IS NULL
    ALTER TABLE FundraisingLicenses ADD IsDeleted BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('FundraisingLicenses','DeleteReason') IS NULL
    ALTER TABLE FundraisingLicenses ADD DeleteReason NVARCHAR(500) NULL;
GO
IF COL_LENGTH('FundraisingLicenses','DeletedBy') IS NULL
    ALTER TABLE FundraisingLicenses ADD DeletedBy INT NULL;
GO
IF COL_LENGTH('FundraisingLicenses','DeletedAt') IS NULL
    ALTER TABLE FundraisingLicenses ADD DeletedAt DATETIME NULL;
GO

-- Grants
IF COL_LENGTH('Grants','IsDeleted') IS NULL
    ALTER TABLE Grants ADD IsDeleted BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('Grants','DeleteReason') IS NULL
    ALTER TABLE Grants ADD DeleteReason NVARCHAR(500) NULL;
GO
IF COL_LENGTH('Grants','DeletedBy') IS NULL
    ALTER TABLE Grants ADD DeletedBy INT NULL;
GO
IF COL_LENGTH('Grants','DeletedAt') IS NULL
    ALTER TABLE Grants ADD DeletedAt DATETIME NULL;
GO

-- Projects
IF COL_LENGTH('Projects','IsDeleted') IS NULL
    ALTER TABLE Projects ADD IsDeleted BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('Projects','DeleteReason') IS NULL
    ALTER TABLE Projects ADD DeleteReason NVARCHAR(500) NULL;
GO
IF COL_LENGTH('Projects','DeletedBy') IS NULL
    ALTER TABLE Projects ADD DeletedBy INT NULL;
GO
IF COL_LENGTH('Projects','DeletedAt') IS NULL
    ALTER TABLE Projects ADD DeletedAt DATETIME NULL;
GO

-- Legislations
IF COL_LENGTH('Legislations','IsDeleted') IS NULL
    ALTER TABLE Legislations ADD IsDeleted BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('Legislations','DeleteReason') IS NULL
    ALTER TABLE Legislations ADD DeleteReason NVARCHAR(500) NULL;
GO
IF COL_LENGTH('Legislations','DeletedBy') IS NULL
    ALTER TABLE Legislations ADD DeletedBy INT NULL;
GO
IF COL_LENGTH('Legislations','DeletedAt') IS NULL
    ALTER TABLE Legislations ADD DeletedAt DATETIME NULL;
GO

-- BannedOrgs
IF COL_LENGTH('BannedOrgs','IsDeleted') IS NULL
    ALTER TABLE BannedOrgs ADD IsDeleted BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('BannedOrgs','DeleteReason') IS NULL
    ALTER TABLE BannedOrgs ADD DeleteReason NVARCHAR(500) NULL;
GO
IF COL_LENGTH('BannedOrgs','DeletedBy') IS NULL
    ALTER TABLE BannedOrgs ADD DeletedBy INT NULL;
GO
IF COL_LENGTH('BannedOrgs','DeletedAt') IS NULL
    ALTER TABLE BannedOrgs ADD DeletedAt DATETIME NULL;
GO

-- OrgEvents (بيانات آخر حدث - نفس منطق التعديل الحالي بالظبط RecordedBy، بنضيف الحذف بسبب فقط)
IF COL_LENGTH('OrgEvents','IsDeleted') IS NULL
    ALTER TABLE OrgEvents ADD IsDeleted BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('OrgEvents','DeleteReason') IS NULL
    ALTER TABLE OrgEvents ADD DeleteReason NVARCHAR(500) NULL;
GO
IF COL_LENGTH('OrgEvents','DeletedBy') IS NULL
    ALTER TABLE OrgEvents ADD DeletedBy INT NULL;
GO
IF COL_LENGTH('OrgEvents','DeletedAt') IS NULL
    ALTER TABLE OrgEvents ADD DeletedAt DATETIME NULL;
GO

PRINT N'✅ STEP 1: تم إضافة أعمدة الحذف بسبب على كل الجداول';
GO

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 1B: أعمدة "الإدارة صاحبة البيانات" + "مين سجّلها" على الجداول اللي
--   كانت ناقصاها (Grants/Projects/Legislations/BannedOrgs/FundraisingLicenses)
--   عشان صلاحية الحذف/التعديل تتحقق فعليًا بنفس منطق OrgEvents/Reports
--   الموجود عندك بالظبط (كل حد يعدّل/يحذف بيانات إدارته هو بس، والمدير يعدّل/يحذف الكل)
-- ─────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('Grants','Department') IS NULL
    ALTER TABLE Grants ADD Department NVARCHAR(100) NULL;
GO
IF COL_LENGTH('Grants','CreatedBy') IS NULL
    ALTER TABLE Grants ADD CreatedBy INT NULL;
GO
IF COL_LENGTH('Projects','Department') IS NULL
    ALTER TABLE Projects ADD Department NVARCHAR(100) NULL;
GO
IF COL_LENGTH('Projects','CreatedBy') IS NULL
    ALTER TABLE Projects ADD CreatedBy INT NULL;
GO
IF COL_LENGTH('Legislations','Department') IS NULL
    ALTER TABLE Legislations ADD Department NVARCHAR(100) NULL;
GO
IF COL_LENGTH('Legislations','CreatedBy') IS NULL
    ALTER TABLE Legislations ADD CreatedBy INT NULL;
GO
IF COL_LENGTH('BannedOrgs','Department') IS NULL
    ALTER TABLE BannedOrgs ADD Department NVARCHAR(100) NULL;
GO
IF COL_LENGTH('BannedOrgs','CreatedBy') IS NULL
    ALTER TABLE BannedOrgs ADD CreatedBy INT NULL;
GO
IF COL_LENGTH('FundraisingLicenses','Department') IS NULL
    ALTER TABLE FundraisingLicenses ADD Department NVARCHAR(100) NULL;
GO

PRINT N'✅ STEP 1B: تم إضافة أعمدة الإدارة/المُسجِّل للجداول الناقصة';
GO


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 2: جدول أعضاء مجلس الإدارة
--   - الرقم القومي لازم يكون 14 رقم بالظبط (شرط CHECK)
--   - إجباري بس لو الشخص المسجَّل هو رئيس المجلس (IsChairman=1)
--     (بنطبّق شرط "إجباري لو رئيس" بـ CHECK يسمح NULL لغير الرئيس، ويمنعه للرئيس)
-- ─────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='BoardMembers')
BEGIN
    CREATE TABLE BoardMembers (
        MemberID INT IDENTITY(1,1) PRIMARY KEY,
        OrgID INT NOT NULL REFERENCES Organizations(OrgID),
        FullName NVARCHAR(200) NOT NULL,
        NationalID CHAR(14) NULL,
        Position NVARCHAR(200) NULL,          -- الوظيفة في مجلس الإدارة
        Phone NVARCHAR(50) NULL,
        IsChairman BIT NOT NULL DEFAULT 0,
        CreatedAt DATETIME DEFAULT GETDATE(),
        CreatedBy INT NULL,
        IsDeleted BIT NOT NULL DEFAULT 0,
        DeleteReason NVARCHAR(500) NULL,
        DeletedBy INT NULL,
        DeletedAt DATETIME NULL,
        -- الرقم القومي (لو مُدخَل) لازم يكون 14 رقم بالظبط ولا يحتوي غير أرقام
        CONSTRAINT CK_BoardMember_NationalID CHECK (NationalID IS NULL OR (LEN(NationalID)=14 AND NationalID NOT LIKE '%[^0-9]%')),
        -- الرقم القومي إجباري فقط لو الشخص ده رئيس مجلس الإدارة
        CONSTRAINT CK_BoardMember_ChairmanRequiresID CHECK (IsChairman=0 OR NationalID IS NOT NULL)
    );
    CREATE INDEX IX_BoardMember_OrgID ON BoardMembers(OrgID);
    CREATE INDEX IX_BoardMember_NationalID ON BoardMembers(NationalID);
    PRINT N'✅ STEP 2: تم إنشاء جدول BoardMembers';
END
ELSE
    PRINT N'ℹ️ STEP 2: جدول BoardMembers موجود بالفعل - تم تخطيه';
GO

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 3: دعم مراجعة الطلبات المكررة / المرتبطة بحدث لجمعية موجودة
--   RequestKind: 'new_org' (طلب إضافة جمعية جديدة - الوضع الافتراضي الحالي)
--                'event_only' (الطلب في الأصل بيانات حدث/بيانات إدارية لجمعية
--                 موجودة بالفعل، مش طلب تسجيل جمعية جديدة)
--   LinkedOrgID: لو تم ربط الطلب بجمعية موجودة فعلاً (بدل ما يتعمل لها سجل جديد)
--   NeedsReview: تتحطّ 1 تلقائيًا لو النظام لقى تطابق محتمل مع جمعية موجودة
--                وقت تقديم الطلب - عشان تظهر في إحصاء "طلبات تحتاج مراجعة"
-- ─────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('AddRequests','RequestKind') IS NULL
    ALTER TABLE AddRequests ADD RequestKind NVARCHAR(30) NOT NULL DEFAULT 'new_org';
GO
IF COL_LENGTH('AddRequests','LinkedOrgID') IS NULL
    ALTER TABLE AddRequests ADD LinkedOrgID INT NULL REFERENCES Organizations(OrgID);
GO
IF COL_LENGTH('AddRequests','NeedsReview') IS NULL
    ALTER TABLE AddRequests ADD NeedsReview BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('AddRequests','RegYear') IS NULL
    ALTER TABLE AddRequests ADD RegYear INT NULL;
GO
IF COL_LENGTH('AddRequests','Level') IS NULL
    ALTER TABLE AddRequests ADD Level NVARCHAR(50) NULL;
GO

PRINT N'✅ STEP 3: تم تجهيز AddRequests لدعم المراجعة والربط بجمعية موجودة';
GO

PRINT N'══════════════════════════════════════════════════';
PRINT N'✅ اكتملت الترقية 20 بنجاح - لا يوجد أي حذف أو تعديل على بيانات موجودة';
PRINT N'══════════════════════════════════════════════════';
GO
