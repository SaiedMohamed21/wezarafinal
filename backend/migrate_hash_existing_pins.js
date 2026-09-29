// ══════════════════════════════════════════════════════════════
// سكريبت تشغيل لمرة واحدة: يقرأ كل المستخدمين اللي لسه عندهم PIN
// نص صريح (من قبل تحديث الأمان) ويحوّلهم لـ bcrypt hash في عمود
// PasswordHash، ثم يمسح العمود القديم PIN تمامًا.
//
// طريقة التشغيل (بعد ضبط بيانات الاتصال في .env زي السيرفر بالظبط):
//   node migrate_hash_existing_pins.js
//
// آمن للتشغيل أكثر من مرة - لو مفيش أي PIN نص صريح متبقي، مش هيعمل حاجة.
// ══════════════════════════════════════════════════════════════
const sql = require('mssql');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const cfg = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'NGO_System',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: { encrypt: false, trustServerCertificate: true }
};

async function run() {
  const pool = await sql.connect(cfg);

  const r = await pool.request()
    .query('SELECT UserID, PIN FROM Users WHERE PIN IS NOT NULL AND LTRIM(RTRIM(PIN)) <> \'\'');

  if (!r.recordset.length) {
    console.log('✅ لا يوجد أي PIN نص صريح متبقٍ - القاعدة نظيفة بالفعل.');
    await pool.close();
    return;
  }

  console.log(`⏳ تم إيجاد ${r.recordset.length} مستخدم لديهم PIN نص صريح - جاري التشفير...`);

  for (const row of r.recordset) {
    const hash = await bcrypt.hash(String(row.PIN), 10);
    await pool.request()
      .input('id', sql.Int, row.UserID)
      .input('ph', sql.NVarChar, hash)
      .query('UPDATE Users SET PasswordHash=@ph, PIN=NULL WHERE UserID=@id');
    console.log(`  ✔ تم تشفير PIN للمستخدم رقم ${row.UserID}`);
  }

  console.log('✅ تم ترحيل جميع كلمات المرور بنجاح.');
  await pool.close();
}

run().catch(err => {
  console.error('❌ فشل الترحيل:', err.message);
  process.exit(1);
});
