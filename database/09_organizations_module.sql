-- ══════════════════════════════════════════════════
-- ترقية 09: موديول "المنظمات" الحقيقي (كان محسوب بأرقام وهمية وتم استبداله بالكامل)
-- كل تسجيل = دفعة/واقعة مستقلة برقم تسلسلي تلقائي (شهر/سنة الحدث + عدد المنظمات
-- + نوع النشاط (متعدد) + الغرض (متعدد) + تجديد/تعديل تصريح + الجنسية (متعدد))
-- ══════════════════════════════════════════════════
USE NGO_System;
GO

-- ── جداول القوائم (تدعم "إضافة اختيار" من الواجهة) ──
CREATE TABLE OrgActivityTypes (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(500) NOT NULL UNIQUE,
    IsActive BIT DEFAULT 1,
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO
CREATE TABLE OrgPurposeTypes (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(500) NOT NULL UNIQUE,
    IsActive BIT DEFAULT 1,
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO
CREATE TABLE OrgNationalityTypes (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL UNIQUE,
    IsActive BIT DEFAULT 1,
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO

-- ── جدول التسجيل الرئيسي (رقم تسلسلي تلقائي = OrgEntryID) ──
CREATE TABLE OrgGeneralEntries (
    OrgEntryID INT IDENTITY(1,1) PRIMARY KEY,
    EventMonth INT NOT NULL,
    EventYear  INT NOT NULL,
    OrgCount   INT NOT NULL DEFAULT 0,          -- عدد المنظمات
    LicenseRenewed BIT DEFAULT 0,                -- تم تجديد تصريح
    LicenseAmended BIT DEFAULT 0,                -- تم تعديل تصريح
    Notes NVARCHAR(2000),
    IsActive BIT DEFAULT 1,
    CreatedBy INT,
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO
CREATE INDEX IX_OrgGeneralEntries_Period ON OrgGeneralEntries(EventYear, EventMonth);
GO

-- ── جداول الربط (اختيار متعدد لكل تسجيل) ──
CREATE TABLE OrgGeneralActivities (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    OrgEntryID INT NOT NULL REFERENCES OrgGeneralEntries(OrgEntryID) ON DELETE CASCADE,
    ActivityName NVARCHAR(500) NOT NULL
);
GO
CREATE TABLE OrgGeneralPurposes (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    OrgEntryID INT NOT NULL REFERENCES OrgGeneralEntries(OrgEntryID) ON DELETE CASCADE,
    PurposeName NVARCHAR(500) NOT NULL
);
GO
CREATE TABLE OrgGeneralNationalities (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    OrgEntryID INT NOT NULL REFERENCES OrgGeneralEntries(OrgEntryID) ON DELETE CASCADE,
    NationalityName NVARCHAR(200) NOT NULL
);
GO
CREATE INDEX IX_OrgGeneralActivities_Entry ON OrgGeneralActivities(OrgEntryID);
CREATE INDEX IX_OrgGeneralPurposes_Entry ON OrgGeneralPurposes(OrgEntryID);
CREATE INDEX IX_OrgGeneralNationalities_Entry ON OrgGeneralNationalities(OrgEntryID);
GO

-- ── تعبئة القوائم كما وردت بالضبط (كل القيم حقيقية من الطلب - لا بيانات وهمية) ──
INSERT INTO OrgActivityTypes(Name) VALUES
(N'مناهضة العنف ضد الأطفال والنساء وتقديم الدعم الفني'),
(N'التدريب والدعم وتحسين الدخل في الزراعة والحرف اليدوية والمشروعات الصغيرة'),
(N'القيام ببرنامج التنمية الاقتصادية'),
(N'رعاية الفئات الخاصة المهمشة'),
(N'دعم أنشطة التعليم ومحو الأمية'),
(N'دعم مشروعات الزراعة المستدامة والطاقة المتجددة وبرامج البيئة'),
(N'دعم التعليم المستمر للشباب والمواطنين'),
(N'تقديم منح للجمعيات الأهلية'),
(N'تحسين حالة الاطفال الصحية وإنشاء مراكز للاطفال المرضى'),
(N'التدريب وبناء القدرات للأطفال والنساء والشباب في مجال التعليم'),
(N'الاستجابة للكوارث الطبيعية والبشرية والأزمات الإنسانية'),
(N'تعزيز قضايا التنمية المستدامة'),
(N'أخرى');
GO

INSERT INTO OrgPurposeTypes(Name) VALUES
(N'دعم أنشطة الجمعيات'),
(N'تنمية الديمقراطية'),
(N'مشروعات صحية'),
(N'مشروعات بيئية'),
(N'مشروعات اقتصادية'),
(N'مشروعات تعليمية'),
(N'دعم حقوق المرأة'),
(N'دعم حقوق الأشخاص ذوي الاعاقة'),
(N'رعاية الحيوان'),
(N'مشروعات صناعية'),
(N'أخرى');
GO

INSERT INTO OrgNationalityTypes(Name) VALUES
(N'العربية'),(N'مقر رئيسي'),(N'الأمريكية'),(N'الفرنسية'),(N'الإيطالية'),
(N'البريطانية'),(N'الغانية'),(N'السويسرية'),(N'البلجيكية'),(N'أخرى');
GO

PRINT N'✅ تم إنشاء موديول المنظمات بالكامل (جداول + قوائم حقيقية) - الإحصاء يبدأ من صفر لحين إدخال بيانات فعلية';
GO
