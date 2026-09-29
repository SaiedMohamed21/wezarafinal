-- ══════════════════════════════════════════════════
-- ترقية 15: طلبات التقارير (من المسؤول/مسؤول تقارير الوزيرة)
-- يحل محل التخزين المؤقت في متغيّر جافاسكريبت (كان يُفقد مع أي تحديث للصفحة)
-- ══════════════════════════════════════════════════
USE NGO_System;
GO

CREATE TABLE ReportRequests (
    RequestID     INT IDENTITY(1,1) PRIMARY KEY,
    Subject       NVARCHAR(500) NOT NULL,
    PeriodFrom    DATE NOT NULL,
    PeriodTo      DATE NOT NULL,
    Deadline      DATE NULL,
    Departments   NVARCHAR(1000) NULL,   -- أسماء الإدارات المطلوب منها التقرير (مفصولة بفواصل)
    IsActive      BIT DEFAULT 1,          -- الطلب النشط الحالي فقط (يظهر تنبيهه للمستخدمين)
    CreatedBy     INT NULL REFERENCES Users(UserID),
    CreatedAt     DATETIME DEFAULT GETDATE()
);
GO

CREATE INDEX IX_ReportRequests_Active ON ReportRequests(IsActive);
GO

PRINT N'✅ تم إنشاء جدول طلبات التقارير (ReportRequests)';
GO
