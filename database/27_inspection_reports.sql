-- 27_inspection_reports.sql
-- إدارة جديدة: تقرير تفتيش الجمعيات (مركزي - شئون جمعيات / مديريات)
-- النطاق (مركزي/مديرية) يتحدد تلقائيًا حسب "مستوى" الجمعية نفسها وقت التسجيل - مفيش اختيار يدوي منفصل.
-- عدم التكرار: (الجمعية + السنة من + السنة إلى) - نفس الفترة لا تتكرر لنفس الجمعية.

IF OBJECT_ID('InspectionReports','U') IS NULL
BEGIN
  CREATE TABLE InspectionReports (
    ReportID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    Scope NVARCHAR(20) NOT NULL, -- 'مركزي' أو 'مديرية' (تُحدَّد تلقائيًا من مستوى الجمعية)
    YearFrom INT NOT NULL,
    YearTo INT NOT NULL,
    AuditorName NVARCHAR(200),
    OpeningBalance DECIMAL(18,2),
    Revenue DECIMAL(18,2),
    Expenses DECIMAL(18,2),
    ClosingBalance DECIMAL(18,2),
    CreatedBy INT,
    CreatedAt DATETIME DEFAULT GETDATE(),
    IsDeleted BIT DEFAULT 0
  );
END
GO
