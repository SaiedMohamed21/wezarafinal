-- ══════════════════════════════════════════════════════════════════
-- مسح كل بيانات الجمعيات والبيانات الإدارية المرتبطة بيها (مسح كامل، مش ناعم)
-- بالترتيب الصحيح عشان القيود الأجنبية (Foreign Keys) متمنعش الحذف
-- ⚠️ لا رجعة فيه - تأكدي إنك مش محتاجة أي حاجة من الداتا الحالية قبل ما تشغّليه
-- ══════════════════════════════════════════════════════════════════
USE NGO_System;
GO

-- الجداول اللي بتشاور على جمعية (لازم تتمسح هي الأول)
DELETE FROM FundraisingLicenses;
DELETE FROM Grants;
DELETE FROM Projects;
DELETE FROM Legislations;
DELETE FROM BannedOrgs;
DELETE FROM Documents;
DELETE FROM QuestionAnswers;
DELETE FROM OrgEvents;
DELETE FROM TransferRequests;
IF OBJECT_ID('InspectionReports','U') IS NOT NULL DELETE FROM InspectionReports;
IF OBJECT_ID('OrgGeneralEntries','U') IS NOT NULL DELETE FROM OrgGeneralEntries;

-- طلبات الإضافة بتشاور على جمعية اختياريًا (LinkedOrgID) - نصفّرها بدل ما نمسح الطلبات نفسها
IF COL_LENGTH('AddRequests','LinkedOrgID') IS NOT NULL
  UPDATE AddRequests SET LinkedOrgID = NULL;

-- أخيرًا: جدول الجمعيات نفسه
DELETE FROM Organizations;

-- إعادة عداد الترقيم التلقائي (IDENTITY) لكل الجداول للصفر عشان الأرقام تبدأ نظيفة من جديد
DBCC CHECKIDENT ('Organizations', RESEED, 0);
DBCC CHECKIDENT ('FundraisingLicenses', RESEED, 0);
DBCC CHECKIDENT ('Grants', RESEED, 0);
DBCC CHECKIDENT ('Projects', RESEED, 0);
DBCC CHECKIDENT ('Legislations', RESEED, 0);
DBCC CHECKIDENT ('BannedOrgs', RESEED, 0);
DBCC CHECKIDENT ('Documents', RESEED, 0);
DBCC CHECKIDENT ('OrgEvents', RESEED, 0);
IF OBJECT_ID('InspectionReports','U') IS NOT NULL DBCC CHECKIDENT ('InspectionReports', RESEED, 0);

PRINT N'✅ تم مسح كل بيانات الجمعيات والبيانات الإدارية المرتبطة بيها. الجدول فاضي وجاهز للاستيراد الجديد.';
GO
