-- ══════════════════════════════════════════════════
-- ترقية 04: جدول التقارير الحقيقي (يحل محل التخزين المؤقت في السيرفر)
-- + دعم "الأغراض والوسائل" + عدد التراخيص السارية (كرقم مُسجَّل يدويًا وليس محسوبًا لحظيًا)
-- ══════════════════════════════════════════════════
USE NGO_System;
GO

CREATE TABLE Reports (
    ReportID        INT IDENTITY(1,1) PRIMARY KEY,
    Department      NVARCHAR(100) NOT NULL,     -- الإدارة (القيد / جمع المال / المنح ...)
    ReportType      NVARCHAR(50)  NOT NULL,      -- شهري / سنوي / ربع سنوي / أسبوعي / خاص
    PeriodFrom      DATE NOT NULL,
    PeriodTo        DATE NOT NULL,

    IssuedCount     INT DEFAULT 0,               -- عدد الصادرة
    ActiveCount     INT DEFAULT 0,               -- عدد السارية (رقم التقرير الرسمي، لا يُحسب لحظيًا)
    LiquidatedCount INT DEFAULT 0,               -- عدد التصفيات

    TotalRevenue    DECIMAL(18,2) DEFAULT 0,     -- إجمالي الحصيلة/الإيرادات
    TotalExpenses   DECIMAL(18,2) DEFAULT 0,
    NetAmount       AS (TotalRevenue - TotalExpenses) PERSISTED,

    TopOrgName      NVARCHAR(500),               -- أعلى حصيلة - اسم الجمعية
    TopOrgAmount    DECIMAL(18,2) DEFAULT 0,      -- أعلى حصيلة - المبلغ

    Purposes        NVARCHAR(1000),              -- الأغراض (نص/مفصول بفواصل)
    Methods         NVARCHAR(1000),              -- الوسائل (نص/مفصول بفواصل)

    Notes           NVARCHAR(2000),
    FilePath        NVARCHAR(1000),

    CreatedBy       INT,
    CreatedAt       DATETIME DEFAULT GETDATE(),

    -- يمنع تكرار نفس التقرير لنفس الإدارة ونفس الفترة بنفس النوع
    CONSTRAINT UQ_Report UNIQUE (Department, ReportType, PeriodFrom, PeriodTo)
);
GO

CREATE INDEX IX_Report_Dept_Period ON Reports(Department, PeriodFrom, PeriodTo);
GO

-- كل الأغراض والوسائل المتاحة (تُدار من صفحة التقارير - جمع المال)
CREATE TABLE FundraisingPurposes (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(300) NOT NULL UNIQUE,
    IsActive BIT DEFAULT 1
);
GO
CREATE TABLE FundraisingMethods (
    ID INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(300) NOT NULL UNIQUE,
    IsActive BIT DEFAULT 1
);
GO

-- الأغراض = نفس "مجالات العمل" الرسمية (WORKFIELDS) المستخدمة فعليًا في نموذج ترخيص جمع المال بالموقع
INSERT INTO FundraisingPurposes(Name) VALUES
(N'مجال رعاية الطفولة والأمومة'),
(N'مجال المساعدات والخدمات الاجتماعية'),
(N'مجال رعاية الأسرة'),
(N'مجال الخدمات الثقافية والعلمية والدينية'),
(N'رعاية الشيخوخة'),
(N'رعاية الفئات الخاصة والمعاقين'),
(N'رعاية المسجونين وأسرهم'),
(N'مجال الدفاع الاجتماعي'),
(N'مجال الخدمات الصحية'),
(N'مجال حماية البيئة والمحافظة عليها'),
(N'مجال التنمية الاقتصادية'),
(N'مجال أصحاب المعاشات'),
(N'الصداقة بين الشعوب'),
(N'مجال النشاط الأدبي'),
(N'مجال التنظيم والإدارة'),
(N'مجال حماية المستهلك'),
(N'مجال تنظيم الأسرة'),
(N'مجال حقوق الإنسان'),
(N'مجال الخدمات التعليمية'),
(N'مجال رعاية الحيوان'),
(N'أخرى');
GO
-- الوسائل = نفس وسائل جمع المال الموجودة فعليًا في نموذج ترخيص جمع المال بالموقع
INSERT INTO FundraisingMethods(Name) VALUES
(N'بنوك'),(N'شركات تحصيل'),(N'طوابع'),(N'إيصالات غير محددة القيمة'),(N'صكوك'),(N'سوق خيري');
GO

PRINT N'✅ تم إنشاء جدول التقارير الحقيقي وجداول الأغراض/الوسائل';
GO
