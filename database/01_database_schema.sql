-- ══════════════════════════════════════════════════
-- NGO System - Complete Database Schema
-- الوحدة المركزية للجمعيات والعمل الأهلي
-- ══════════════════════════════════════════════════
CREATE DATABASE NGO_System COLLATE Arabic_CI_AS;
GO
USE NGO_System;
GO

CREATE TABLE Organizations (
    OrgID INT IDENTITY(1,1) PRIMARY KEY,
    OrgName NVARCHAR(500) NOT NULL,
    OrgType NVARCHAR(50) NOT NULL DEFAULT N'جمعية',
    RegNum INT NOT NULL,
    RegYear INT,
    UnifiedNumber NVARCHAR(50),
    Level NVARCHAR(50) NOT NULL DEFAULT N'مركزي',
    Address NVARCHAR(1000),
    Governorate NVARCHAR(100),
    Directorate NVARCHAR(100),
    Chairman NVARCHAR(200),
    Phone NVARCHAR(200),
    WorkField NVARCHAR(500),
    PublicBenefit BIT DEFAULT 0,
    PublicBenefitDecree NVARCHAR(200),
    PublicBenefitYear INT,
    Status NVARCHAR(100) DEFAULT N'نشطة',
    NameChanged BIT DEFAULT 0,
    PreviousName NVARCHAR(500),
    PreviousGov NVARCHAR(100),
    NameChangeDate DATE,
    PrevRegNum INT, PrevRegYear INT, PrevGovTransfer NVARCHAR(100),
    TransferDate DATE,
    NewRegNum INT, NewRegYear INT, NewGovTransfer NVARCHAR(100),
    Notes NVARCHAR(2000),
    IsActive BIT DEFAULT 1,
    CreatedAt DATETIME DEFAULT GETDATE(),
    UpdatedAt DATETIME DEFAULT GETDATE(),
    CreatedBy INT,
    CONSTRAINT UQ_RegNum_Year_Level UNIQUE (RegNum, RegYear, Level)
);
GO

CREATE TABLE Users (
    UserID INT IDENTITY(1,1) PRIMARY KEY,
    FullName NVARCHAR(200) NOT NULL,
    NationalID NVARCHAR(14),
    Department NVARCHAR(100),
    Permission NVARCHAR(50),
    PasswordHash NVARCHAR(256),
    PIN NVARCHAR(10),
    IsApproved BIT DEFAULT 0,
    IsActive BIT DEFAULT 1,
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE FundraisingLicenses (
    LicID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    LicenseNumber NVARCHAR(100) NOT NULL,
    LicenseStatus NVARCHAR(50) DEFAULT N'ساري',
    IssueDate DATE, IssueMonth INT, IssueYear INT,
    StartDate DATE, EndDate DATE,
    Deadline60 AS (DATEADD(DAY, 60, EndDate)) PERSISTED,
    LiquidationDate DATE, LiquidationMonth INT, LiquidationYear INT,
    Revenue DECIMAL(18,2) DEFAULT 0,
    Expenses DECIMAL(18,2) DEFAULT 0,
    NetAmount AS (Revenue - Expenses) PERSISTED,
    LiquidationStatus NVARCHAR(100),
    DataType NVARCHAR(50) DEFAULT N'جديدة',
    CollectionMethods NVARCHAR(500),
    LicensePurpose NVARCHAR(1000),
    CreatedAt DATETIME DEFAULT GETDATE(),
    CreatedBy INT,
    CONSTRAINT UQ_License UNIQUE (OrgID, LicenseNumber)
);
GO

CREATE TABLE Grants (
    GrantID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    GrantName NVARCHAR(500) NOT NULL,
    GrantType NVARCHAR(50), Amount DECIMAL(18,2) DEFAULT 0,
    GrantYear INT, Notes NVARCHAR(1000),
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE Projects (
    ProjectID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    ProjectType NVARCHAR(100), IsAssigned BIT DEFAULT 0,
    Count INT DEFAULT 1, Notes NVARCHAR(1000),
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE Legislations (
    LegID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    DecreeType NVARCHAR(100), DecreeNumber NVARCHAR(100), DecreeDate DATE,
    Notes NVARCHAR(1000), CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE BannedOrgs (
    BanID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    FundsConfiscated BIT DEFAULT 0, HasCase BIT DEFAULT 0,
    CaseNumber NVARCHAR(100), IsSuspended BIT DEFAULT 0,
    DissolutionStatus BIT DEFAULT 0, DecreeNumber NVARCHAR(100), DecreeDate DATE,
    Notes NVARCHAR(1000), CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE Documents (
    DocID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    DocType NVARCHAR(100), DocName NVARCHAR(500), FilePath NVARCHAR(1000),
    UploadedBy INT, UploadedAt DATETIME DEFAULT GETDATE(),
    IsReplaced BIT DEFAULT 0, ReplacedAt DATETIME
);
GO

CREATE TABLE MandatoryQuestions (
    QuestionID INT IDENTITY(1,1) PRIMARY KEY,
    QuestionText NVARCHAR(500) NOT NULL, Department NVARCHAR(100),
    QuestionType NVARCHAR(50) DEFAULT N'yesno', Options NVARCHAR(1000),
    IsActive BIT DEFAULT 1, AddedBy INT, CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE QuestionAnswers (
    AnswerID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    QuestionID INT NOT NULL REFERENCES MandatoryQuestions(QuestionID),
    Answer NVARCHAR(1000), AnsweredBy INT, AnsweredAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE OrgEvents (
    EventID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    EventType NVARCHAR(100), Subject NVARCHAR(1000), EventDate DATE,
    Department NVARCHAR(100), RecordedBy INT, CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE AddRequests (
    ReqID INT IDENTITY(1,1) PRIMARY KEY,
    OrgName NVARCHAR(500), OrgType NVARCHAR(50), RegNum NVARCHAR(50),
    Governorate NVARCHAR(100), Address NVARCHAR(1000), WorkField NVARCHAR(500),
    Chairman NVARCHAR(200), Phone NVARCHAR(200),
    Status NVARCHAR(50) DEFAULT N'pending',
    RequestedBy INT, ReviewedBy INT, CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE RegistrationRequests (
    ReqID INT IDENTITY(1,1) PRIMARY KEY,
    FullName NVARCHAR(200) NOT NULL, NationalID NVARCHAR(14),
    Department NVARCHAR(100), Permission NVARCHAR(50),
    Status NVARCHAR(50) DEFAULT N'pending',
    ReviewedBy INT, CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE TABLE TransferRequests (
    ReqID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT REFERENCES Organizations(OrgID),
    RequestType NVARCHAR(100), OrgRegNum INT, OrgRegYear INT,
    Status NVARCHAR(50) DEFAULT N'pending',
    RequestedBy INT, CreatedAt DATETIME DEFAULT GETDATE()
);
GO

CREATE INDEX IX_Org_RegNum ON Organizations(RegNum);
CREATE INDEX IX_Org_Level ON Organizations(Level);
CREATE INDEX IX_Org_Status ON Organizations(Status);
CREATE INDEX IX_Org_Gov ON Organizations(Governorate);
CREATE INDEX IX_Lic_OrgID ON FundraisingLicenses(OrgID);
CREATE INDEX IX_Lic_IssueYear ON FundraisingLicenses(IssueYear);
CREATE INDEX IX_Lic_LiqYear ON FundraisingLicenses(LiquidationYear);
CREATE INDEX IX_Lic_Status ON FundraisingLicenses(LicenseStatus);
GO

CREATE PROCEDURE SP_FundraisingMonthlyReport @Month INT, @Year INT AS
BEGIN
    SELECT 'التراخيص الصادرة' AS ReportSection, COUNT(*) AS Count, NULL AS Revenue, NULL AS Expenses, NULL AS Net
    FROM FundraisingLicenses WHERE IssueMonth=@Month AND IssueYear=@Year
    UNION ALL
    SELECT 'التصفيات الفعلية', COUNT(*), SUM(Revenue), SUM(Expenses), SUM(NetAmount)
    FROM FundraisingLicenses WHERE LiquidationMonth=@Month AND LiquidationYear=@Year
    UNION ALL
    SELECT 'داخل مهلة التصفية', COUNT(*), SUM(Revenue), SUM(Expenses), SUM(NetAmount)
    FROM FundraisingLicenses WHERE LiquidationMonth=@Month AND LiquidationYear=@Year AND LiquidationDate<=Deadline60
    UNION ALL
    SELECT 'بعد مهلة التصفية', COUNT(*), SUM(Revenue), SUM(Expenses), SUM(NetAmount)
    FROM FundraisingLicenses WHERE LiquidationMonth=@Month AND LiquidationYear=@Year AND LiquidationDate>Deadline60
    UNION ALL
    SELECT 'التصفيات المتوقعة', COUNT(*), NULL, NULL, NULL
    FROM FundraisingLicenses WHERE MONTH(Deadline60)=@Month AND YEAR(Deadline60)=@Year
    UNION ALL
    SELECT 'بيانات جديدة', COUNT(*), NULL, NULL, NULL FROM FundraisingLicenses WHERE DataType=N'جديدة'
    UNION ALL
    SELECT 'بيانات قديمة', COUNT(*), NULL, NULL, NULL FROM FundraisingLicenses WHERE DataType=N'قديمة'
    UNION ALL
    SELECT 'بدون تاريخ تصفية', COUNT(*), NULL, NULL, NULL FROM FundraisingLicenses WHERE LiquidationDate IS NULL;
END
GO

CREATE PROCEDURE SP_FundraisingAnnualReport @Year INT AS
BEGIN
    DECLARE @StartDate DATE = DATEFROMPARTS(@Year,1,1)
    DECLARE @EndDate DATE = DATEFROMPARTS(@Year,12,31)
    SELECT
        COUNT(CASE WHEN StartDate<=@EndDate AND EndDate>=@StartDate THEN 1 END) AS ActiveLicenses,
        COUNT(CASE WHEN LiquidationYear=@Year THEN 1 END) AS TotalLiquidated,
        SUM(CASE WHEN LiquidationYear=@Year THEN Revenue ELSE 0 END) AS TotalRevenue,
        SUM(CASE WHEN LiquidationYear=@Year THEN Expenses ELSE 0 END) AS TotalExpenses,
        SUM(CASE WHEN LiquidationYear=@Year THEN NetAmount ELSE 0 END) AS TotalNet
    FROM FundraisingLicenses;

    SELECT 'التراخيص السارية' AS Section, COUNT(*) AS Count, NULL AS Revenue, NULL AS Expenses, NULL AS Net
    FROM FundraisingLicenses WHERE StartDate<=@EndDate AND EndDate>=@StartDate
    UNION ALL
    SELECT 'التصفيات الفعلية', COUNT(*), SUM(Revenue), SUM(Expenses), SUM(NetAmount)
    FROM FundraisingLicenses WHERE LiquidationYear=@Year
    UNION ALL
    SELECT 'داخل مهلة التصفية', COUNT(*), SUM(Revenue), SUM(Expenses), SUM(NetAmount)
    FROM FundraisingLicenses WHERE LiquidationYear=@Year AND LiquidationDate<=Deadline60
    UNION ALL
    SELECT 'بعد مهلة التصفية', COUNT(*), SUM(Revenue), SUM(Expenses), SUM(NetAmount)
    FROM FundraisingLicenses WHERE LiquidationYear=@Year AND LiquidationDate>Deadline60
    UNION ALL
    SELECT 'التصفيات المتوقعة', COUNT(*), NULL, NULL, NULL FROM FundraisingLicenses WHERE YEAR(Deadline60)=@Year
    UNION ALL
    SELECT 'بيانات جديدة', COUNT(*), NULL, NULL, NULL FROM FundraisingLicenses WHERE DataType=N'جديدة'
    UNION ALL
    SELECT 'بيانات قديمة', COUNT(*), NULL, NULL, NULL FROM FundraisingLicenses WHERE DataType=N'قديمة'
    UNION ALL
    SELECT 'ناقصة البيانات', COUNT(*), NULL, NULL, NULL
    FROM FundraisingLicenses WHERE LiquidationDate IS NULL AND LicenseStatus=N'متصفي';
END
GO

INSERT INTO Users (FullName, Department, Permission, PIN, IsApproved, IsActive) VALUES
(N'أحمد محمد السيد',N'القيد',N'entry',N'1234',1,1),
(N'سارة عبد الرحمن',N'جمع المال',N'entry',N'5678',1,1),
(N'خالد إبراهيم حسن',N'المنح',N'edit',N'9012',1,1),
(N'منى السيد علي',N'المشروعات',N'entry',N'3456',1,1),
(N'يوسف عبد الله',N'التشريعات',N'review',N'7890',1,1),
(N'هبة كامل فؤاد',N'المحظورة',N'entry',N'2345',1,1),
(N'رانيا توفيق',N'كل الإدارات',N'incomplete',N'6789',1,1),
(N'نادية حلمي',N'البيانات الثابتة',N'fixed_edit',N'4321',1,1),
(N'محمود رشدي',N'تقارير الوزيرة',N'minister',N'8765',1,1),
(N'فاطمة حسين',N'المستندات',N'doc_manager',N'1357',1,1),
(N'د. عمرو الجندي',N'الإدارة',N'admin',N'0001',1,1),
(N'🧪 (معاينة) مستخدم تعديل - جمع المال',N'جمع المال',N'edit',N'9999',1,1);
GO

INSERT INTO MandatoryQuestions (QuestionText, Department, QuestionType, AddedBy) VALUES
(N'هل حاصلة على تراخيص جمع المال؟',N'جمع المال',N'yesno',1),
(N'هل حاصلة على منح؟',N'المنح',N'yesno',1),
(N'لديها مشروع مسند؟',N'المشروعات',N'yesno',1),
(N'حاصلة على صفة النفع العام؟',N'القيد',N'yesno',1),
(N'نوع المشروعات',N'المشروعات',N'multi',1);
GO

PRINT N'✅ تم إنشاء قاعدة البيانات بنجاح';
GO
