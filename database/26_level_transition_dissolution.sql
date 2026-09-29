-- 26_level_transition_dissolution.sql
-- تتبّع "أصبحت مركزية من مديرية" / "أصبحت محلية لمديرية من مركزي" + تاريخ حل الجمعية (بغض النظر
-- عن الإدارة اللي حسمت الحل - تشريعات أو محظورة) - يظهر في عمود "حالة الجمعية" بكل مكان

IF COL_LENGTH('Organizations','LevelChangeNote') IS NULL
  ALTER TABLE Organizations ADD LevelChangeNote NVARCHAR(500) NULL;

IF COL_LENGTH('Organizations','LevelChangeDate') IS NULL
  ALTER TABLE Organizations ADD LevelChangeDate DATE NULL;

IF COL_LENGTH('Organizations','DissolutionDate') IS NULL
  ALTER TABLE Organizations ADD DissolutionDate DATE NULL;
