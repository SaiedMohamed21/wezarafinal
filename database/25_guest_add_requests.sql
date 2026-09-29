-- 25_guest_add_requests.sql
-- إضافة إمكانية "تسجيل جمعية جديدة" و"طلباتي" لأي شخص بدون تسجيل دخول:
-- SubmitterName / SubmitterNationalID: اسم ورقم قومي مقدّم الطلب (بدل الاعتماد على RequestedBy لمستخدم مسجَّل دخوله)
-- IsFirstTime: هل هذه جمعية جديدة فعلاً لأول مرة (1) أو جمعية قديمة غير مسجَّلة عندنا (0)

IF COL_LENGTH('AddRequests','SubmitterName') IS NULL
  ALTER TABLE AddRequests ADD SubmitterName NVARCHAR(200) NULL;

IF COL_LENGTH('AddRequests','SubmitterNationalID') IS NULL
  ALTER TABLE AddRequests ADD SubmitterNationalID NVARCHAR(20) NULL;

IF COL_LENGTH('AddRequests','IsFirstTime') IS NULL
  ALTER TABLE AddRequests ADD IsFirstTime BIT NULL;

-- RequestedBy لازم يقبل NULL عشان الطلبات اللي بيبعتها ضيف بدون حساب
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id=OBJECT_ID('AddRequests') AND name='RequestedBy' AND is_nullable=0
)
  ALTER TABLE AddRequests ALTER COLUMN RequestedBy INT NULL;
