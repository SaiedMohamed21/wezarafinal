-- ══════════════════════════════════════════════════════════════════════
-- ترقية 24: تصحيح قيد التكرار الفعلي لرقم القيد (RegNum) في جدول Organizations
-- ══════════════════════════════════════════════════════════════════════
-- القاعدة الصحيحة (متطابقة مع فحص الكود في السيرفر - checkRegNumDuplicate):
--   1) رقم القيد "المركزي" مساحة واحدة عامة لكل الجمهورية: نفس رقم القيد
--      ممنوع يتكرر في أي تسجيل مركزي تاني، بغض النظر عن السنة أو المديرية.
--   2) رقم القيد "المديرية" ممنوع يتكرر تاني في نفس المديرية، بغض النظر
--      عن السنة (يعني رقم قيد 1 في القاهرة ميتكررش تاني في القاهرة ولو
--      بسنة مختلفة). نفس الرقم في مديرية مختلفة (زي المنوفية) مسموح عادي.
--   القيد القديم UQ_RegNum_Year_Level كان غلط في الاتجاهين: كان بيمنع
--   بالغلط نفس الرقم لو في مديريتين مختلفتين بنفس السنة (رغم إن ده
--   مفروض يبقى مسموح)، وفي نفس الوقت ماكانش بيمنع تكرار رقم قيد "مركزي"
--   لو اتسجل تاني بمديرية أو سنة مختلفة (وده المفروض يبقى ممنوع خالص).
--
-- الحل: حذف القيد القديم، واستبداله بفهرسين فريدين "مُفلترين" (Filtered
--   Unique Index) - نفس أسلوب UQ_License وUQ_Project_Serial المستخدم
--   بالفعل في السكريبتات 09b و23 - كل فهرس بيطبّق جزء من القاعدة بس.
--
-- طريقة التشغيل: افتحي SQL Server Management Studio (أو أي أداة تنفيذ SQL)
-- متصلة بقاعدة NGO_System، وشغّلي السكريبت ده مرة واحدة بس.
-- (لو كنتي شغّلتي نسخة سابقة من السكريبت ده قبل كده، شغّلي النسخة دي
-- فوقها عادي - هتشيل الفهرس القديم اللي كان بيراعي السنة وتستبدله بالصح)
-- ══════════════════════════════════════════════════════════════════════

USE NGO_System;
GO

-- 1) نتأكد الأول إن مفيش بيانات موجودة بالفعل هتتعارض مع القيد الجديد
DECLARE @centralDup INT, @directorateDup INT;

SELECT @centralDup = COUNT(*) FROM (
  SELECT RegNum
  FROM Organizations
  WHERE Level = N'مركزي' AND ISNULL(IsActive,1) = 1
  GROUP BY RegNum
  HAVING COUNT(*) > 1
) t;

SELECT @directorateDup = COUNT(*) FROM (
  SELECT RegNum, Governorate
  FROM Organizations
  WHERE Level = N'مديرية' AND ISNULL(IsActive,1) = 1
  GROUP BY RegNum, Governorate
  HAVING COUNT(*) > 1
) t;

IF @centralDup > 0
BEGIN
  PRINT N'⚠️ تحذير: يوجد بالفعل أكثر من جمعية "مركزي" نشطة بنفس رقم القيد. راجعيها يدوياً قبل تشغيل السكريبت ده تاني.';
END
ELSE IF @directorateDup > 0
BEGIN
  PRINT N'⚠️ تحذير: يوجد بالفعل أكثر من جمعية "مديرية" نشطة بنفس رقم القيد ونفس المديرية (بسنين مختلفة). راجعيها يدوياً قبل تشغيل السكريبت ده تاني.';
END
ELSE
BEGIN
  -- 2) حذف القيد القديم (لو لسه موجود)
  IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name='UQ_RegNum_Year_Level')
    ALTER TABLE Organizations DROP CONSTRAINT UQ_RegNum_Year_Level;

  -- 3) لو كنتي شغّلتي نسخة سابقة من السكريبت ده، نشيل الفهرس القديم اللي
  --    كان بيراعي السنة برضو، عشان نستبدله بالفهرس الصح اللي من غير سنة
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_RegNum_Year_Gov_Directorate')
    DROP INDEX UQ_RegNum_Year_Gov_Directorate ON Organizations;

  -- 4) فهرس فريد لأرقام القيد "المركزي": نفس الرقم ممنوع يتكرر في أي
  --    تسجيل مركزي تاني، بغض النظر عن السنة. (RegNum عمود NOT NULL أصلاً
  --    في الجدول، فالحماية دي مضمونة 100% من غير أي استثناء NULL).
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_RegNum_Central')
    CREATE UNIQUE INDEX UQ_RegNum_Central ON Organizations(RegNum)
    WHERE Level = N'مركزي';

  -- 5) فهرس فريد لأرقام القيد "المديرية": الفرادة هنا على (رقم القيد +
  --    المديرية) بس، من غير السنة خالص - يعني نفس الرقم مسموح في مديرية
  --    تانية، لكن ممنوع يتكرر تاني في نفس المديرية ولو بسنة مختلفة.
  --    (ملحوظة زي UQ_License بالظبط: لو Governorate كانت NULL في صف
  --    قديم، SQL Server مايعتبرش القيمتين NULL متساويتين، فالحماية دي
  --    كافية عملياً على البيانات الحقيقية)
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UQ_RegNum_Gov_Directorate')
    CREATE UNIQUE INDEX UQ_RegNum_Gov_Directorate ON Organizations(RegNum, Governorate)
    WHERE Level = N'مديرية';

  PRINT N'✅ تم تحديث قيد التكرار بنجاح: المركزي فريد برقم القيد بس (أي سنة/مديرية)، والمديرية فريدة بـ(رقم القيد + المديرية) بغض النظر عن السنة.';
END
GO
