-- ══════════════════════════════════════════════════════════
-- ترقية جدول BannedOrgs: إضافة عمودين ناقصين حتى يطابق الجدول
-- كل أسئلة استمارة "المحظورة" (كانت الاستمارة فيها 6 أسئلة والجدول
-- فيه أعمدة لـ 4 أسئلة فقط، فكانت إجابتا "تم حظرها؟" و"جاري إجراءات
-- الحل؟" بتضيع ومحدش بيحفظهم). شغّل هذا الملف مرة واحدة فقط على
-- قاعدة البيانات الحالية (لن يؤثر على أي بيانات موجودة).
-- ══════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('BannedOrgs') AND name='IsBanned')
  ALTER TABLE BannedOrgs ADD IsBanned BIT DEFAULT 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('BannedOrgs') AND name='DissolutionInProgress')
  ALTER TABLE BannedOrgs ADD DissolutionInProgress BIT DEFAULT 0;
GO
