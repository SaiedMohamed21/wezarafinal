USE NGO_System;
GO
IF COL_LENGTH('Reports','ReportData') IS NULL
    ALTER TABLE Reports ADD ReportData NVARCHAR(MAX) NULL;
GO
PRINT N'تم إضافة عمود ReportData لتخزين بيانات التقرير الخاصة بكل إدارة (المنح/المشروعات/التشريعات/المحظورة/القيد) بصيغة JSON';
GO
