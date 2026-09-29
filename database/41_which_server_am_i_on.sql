-- شغّلي السطر ده بس (معاينة، مفيهوش أي تعديل) في كل شاشة SSMS مفتوحة
-- عندك، وابعتيلي الناتج من كل واحدة - عشان نعرف كل شاشة متوصلة
-- بالظبط بأنهي نسخة/قاعدة بيانات.
SELECT
  @@SERVERNAME       AS ServerName,
  SERVERPROPERTY('ProductVersion') AS Version,
  DB_NAME()          AS CurrentDatabase,
  (SELECT COUNT(*) FROM FundraisingLicenses WHERE ISNULL(IsDeleted,0)=0 AND LicenseStatus=N'متصفي' AND LiquidationYear IS NULL) AS StillMissingLiquidationYear;
