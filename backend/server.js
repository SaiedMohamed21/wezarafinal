const express=require('express');
const sql=require('mssql');
const cors=require('cors');
const path=require('path');
// (جديد) لدمج/إضافة صفحة جديدة لآخر ملف PDF موجود (أو تحويل صورة موجودة لأول صفحة PDF ثم
// إضافة صفحات بعدها) - مكتبة جافاسكريبت خالص، مش محتاجة أي برنامج تاني متثبَّت على السيرفر.
// يجب تشغيل: npm install pdf-lib
const{PDFDocument}=require('pdf-lib');
const fs=require('fs');
const multer=require('multer');
const bcrypt=require('bcryptjs'); // لتشفير PIN المستخدمين (bcryptjs: جافاسكريبت خالص، لا يحتاج بناء/ترجمة)
const jwt=require('jsonwebtoken'); // لإصدار والتحقق من جلسات تسجيل الدخول (يجب: npm install jsonwebtoken)
// ══════════════════════════════════════════════════════════════════════
// (جديد v30) ضغط الاستجابات (Gzip) - بعد ما البيانات كبرت لعشرات الآلاف من
// الجمعيات، ردود الـ API (خصوصًا /api/organizations) بقت كبيرة جدًا كنص JSON
// خام (ممكن توصل لعشرات الميجابايت)، وده كان بيخلي تحميل الموقع ياخد وقت طويل
// جدًا أو يفضل "معلّق" من غير أي رسالة خطأ - خصوصًا على إنترنت بطيء.
// الضغط بيقلل حجم الاستجابة بنسبة 80-90% تقريبًا لأي رد نصي/JSON، من غير أي
// تغيير في شكل البيانات نفسها أو في أي كود تاني - شفاف تمامًا.
// يتطلب: npm install compression
// ══════════════════════════════════════════════════════════════════════
const compression=require('compression');
require('dotenv').config();
const app=express();
app.use(cors());
app.use(compression()); // (جديد v30) ضغط كل الاستجابات - راجع الشرح فوق
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

// يحوّل أي قيمة متعددة (Array من خانات اختيار متعددة) لنص مفصول بفواصل قبل إرسالها كـ NVarChar -
// حماية إضافية من جهة السيرفر لو الواجهة بعتت Array بالغلط (زي وسائل تحصيل جمع المال) بدل نص جاهز،
// وده كان سبب باج "Validation failed for parameter. Invalid string" اللي كان بيمنع الحفظ بالكامل.
function toCsv(v){
  if(v==null) return null;
  if(Array.isArray(v)) return v.filter(Boolean).join(',')||null;
  return v;
}

// ══════════════════════════════════════════════════════════════════════
// ══ إصلاح جذري عام: كل التعديلات (كل الإدارات) لازم "تدمج" مع السجل
// الأصلي بدل ما "تستبدله بالكامل". ══
// المشكلة اللي كانت موجودة: أي endpoint تعديل (PUT) كان بياخد قيمة كل عمود
// من جسم الطلب مباشرة، ولو الواجهة (شاشة تعديل معينة) معندهاش خانة لعمود
// معين (زي تاريخ الإصدار في شاشة "تعديل بيانات إدارية - جمع المال") كان
// بيوصل السيرفر undefined، والسيرفر كان يحوّله NULL ويمسح القيمة الأصلية
// في قاعدة البيانات فورًا عند الحفظ - حتى لو المستخدم مامسّهاش خالص.
// وده كان سبب مباشر لعطل الإحصاء: أعمدة زي IssueMonth/IssueYear/
// LiquidationMonth/LiquidationYear (اللي كل تقارير جمع المال الشهرية/
// السنوية معتمدة عليها) كانت بتترمي NULL بعد أي تعديل، فالسجل يختفي من
// كل إحصاء شهر/سنة رغم إن بياناته الحقيقية سليمة.
// الحل: كل PUT بيجيب السجل الحالي من قاعدة البيانات أولاً، وبعدين يستخدم
// mergeField() اللي يرجّع القيمة الجديدة بس لو المفتاح موجود فعلاً في جسم
// الطلب (حتى لو null - يعني المستخدم مسحها عمدًا)، وإلا يحافظ على القيمة
// الأصلية زي ما هي. كده أي شاشة تعديل ناقصة (حالياً أو مستقبلاً) في أي
// إدارة مش هتمسح بيانات موجودة بالغلط ولا هتكسر الإحصاء.
function mergeField(body, cur, key, curKey){
  return Object.prototype.hasOwnProperty.call(body, key) ? body[key] : cur[curKey || key];
}
// يحوّل تاريخ (نص أو Date راجع من قاعدة البيانات) لصيغة YYYY-MM-DD ثابتة
function toDateStr(v){
  if(!v) return null;
  if(v instanceof Date) return v.toISOString().split('T')[0];
  const m=/^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m?m[1]:null;
}
// ══ فحص تكرار رقم القيد - القاعدة الصحيحة: ══
// 1) لو رقم القيد ده مسجل "مركزي" لجمعية تانية (بغض النظر عن السنة/المديرية) => تكرار مرفوض،
//    لأن أرقام القيد المركزي مساحة واحدة عامة لكل الجمهورية.
// 2) لو رقم القيد ده مسجل "مديرية" لجمعية تانية في نفس المديرية بالظبط => تكرار مرفوض،
//    بغض النظر عن السنة (يعني رقم قيد 1 في القاهرة ميتكررش تاني في القاهرة
//    ولو بسنة مختلفة). نفس الرقم في مديرية مختلفة (زي المنوفية مثلاً) مسموح عادي.
// ملحوظة: القاعدة دي متطابقة دلوقتي مع الفهرسين الفريدين المُفلترين في قاعدة البيانات
// (UQ_RegNum_Central وUQ_RegNum_Gov_Directorate - شوفي 24_regnum_central_directorate_uniqueness.sql)
// بترجع الصف المتعارض (لو موجود) أو null، عشان نقدر نحدد رسالة الخطأ المناسبة.
const N_MARKAZI='مركزي';
async function checkRegNumDuplicate(dbConn, {rn, lv, gv, excludeId}){
  const r=dbConn.request().input('rn',sql.Int,rn).input('gv',sql.NVarChar,gv||null);
  if(excludeId) r.input('id',sql.Int,excludeId);
  // (مُعدَّل) القيد الفعلي في قاعدة البيانات (UQ_RegNum_Central / UQ_RegNum_Gov_Directorate)
  // مبيفرقش بين النشط وغير النشط - فالفحص هنا لازم يطابقه بالظبط، وإلا هيوصل الطلب
  // لقاعدة البيانات ويتصدم بخطأ SQL خام بدل رسالة عربي مفهومة.
  const levelCond = lv===N_MARKAZI
    ? `Level=N'مركزي' AND RegNum=@rn`
    : `Level=N'مديرية' AND RegNum=@rn AND ISNULL(Governorate,N'')=ISNULL(@gv,N'')`;
  const q=await r.query(`
    SELECT TOP 1 OrgID,OrgName,Level,RegYear,Governorate,Status,IsActive FROM Organizations
    WHERE 1=1
      ${excludeId?'AND OrgID<>@id':''}
      AND (${levelCond})`);
  return q.recordset[0]||null;
}
// ══ فحص تكرار "رقم الوارد" - نفس الجمعية + نفس رقم الوارد + نفس تاريخ الوارد ممنوع
//    يتكرر لحدثين مختلفين (بغض النظر عن الموضوع/النوع/الإدارة) ══
async function checkIncomingNumDuplicate(dbConn,{orgId,inNum,inDate,excludeEventId}){
  if(!orgId || !inNum || !inDate) return null;
  const r=dbConn.request().input('oid',sql.Int,orgId).input('in',sql.NVarChar,String(inNum).trim()).input('ind',sql.Date,inDate);
  if(excludeEventId) r.input('id',sql.Int,excludeEventId);
  const q=await r.query(`SELECT TOP 1 EventID,Subject FROM OrgEvents
    WHERE OrgID=@oid AND IncomingNum=@in AND IncomingDate=@ind AND ISNULL(IsDeleted,0)=0
    ${excludeEventId?'AND EventID<>@id':''}`);
  return q.recordset[0]||null;
}
// ══ فحص تكرار "رقم الصادر" - بيدوّر جوّه كل الإجراءات (Actions - JSON) المسجَّلة على كل
//    أحداث نفس الجمعية؛ نفس رقم الصادر + نفس تاريخ الصادر ممنوع يتكرر مرتين ══
async function checkOutgoingNumDuplicate(dbConn,{orgId,actions,excludeEventId}){
  const toCheck=(Array.isArray(actions)?actions:[]).filter(a=>a && a.outNum && a.outDate);
  if(!orgId || !toCheck.length) return null;
  const r=dbConn.request().input('oid',sql.Int,orgId);
  if(excludeEventId) r.input('id',sql.Int,excludeEventId);
  const rows=(await r.query(`SELECT EventID,Subject,Actions FROM OrgEvents
    WHERE OrgID=@oid AND ISNULL(IsDeleted,0)=0 ${excludeEventId?'AND EventID<>@id':''}`)).recordset;
  for(const row of rows){
    let acts=[]; try{ acts=row.Actions?JSON.parse(row.Actions):[]; }catch(e){ acts=[]; }
    for(const a of acts){
      if(!a||!a.outNum||!a.outDate) continue;
      for(const nc of toCheck){
        if(String(a.outNum).trim()===String(nc.outNum).trim() && a.outDate===nc.outDate){
          return {EventID:row.EventID, Subject:row.Subject, outNum:a.outNum, outDate:a.outDate};
        }
      }
    }
  }
  return null;
}
function regNumDuplicateMessage(dupRow){
  const inactiveNote = dupRow.IsActive===false||dupRow.IsActive===0 ? ' (السجل القديم غير نشط حاليًا لكنه لسه محجوز في قاعدة البيانات)' : '';
  return dupRow.Level===N_MARKAZI
    ? 'رقم القيد هذا مسجل مسبقاً كتسجيل مركزي - لا يمكن استخدام نفس الرقم في أي تسجيل مركزي تاني'+inactiveNote
    : 'رقم القيد هذا مسجل مسبقاً في نفس المديرية ('+(dupRow.Governorate||'')+') بغض النظر عن السنة'+inactiveNote;
}
// مصدر الحقيقة لشهر/سنة أي تاريخ (إصدار/تصفية/إلخ) هو التاريخ الكامل نفسه،
// مصدر الحقيقة لشهر/سنة أي تاريخ (إصدار/تصفية/إلخ) هو التاريخ الكامل نفسه،
// وليس خانة "الشهر"/"السنة" المنفصلة في الواجهة (ممكن تفضل بقيمتها الافتراضية
// لو المستخدم دخل التاريخ الفعلي بس ومساش الخانة دي).
function ymParts(v){
  const s=toDateStr(v);
  const m=s?/^(\d{4})-(\d{2})-\d{2}/.exec(s):null;
  return m?{y:parseInt(m[1]),m:parseInt(m[2])}:null;
}
// ══════════════════════════════════════════════════════════════════════

const BCRYPT_ROUNDS=10;
async function hashPin(pin){ return bcrypt.hash(String(pin),BCRYPT_ROUNDS); }
async function verifyPin(pin,hash){ if(!hash) return false; return bcrypt.compare(String(pin),hash); }

// ══ الجلسات (JWT) ══
// مهم جداً: لازم تحدد JWT_SECRET في ملف .env بقيمة عشوائية طويلة وثابتة.
// (تصحيح) قبل كده لو ماكانش محدد، كان بيتولّد سر عشوائي جديد فى الذاكرة كل مرة السيرفر
// يتشغّل من الأول - ومعناه أي إعادة تشغيل للسيرفر (شائعة جدًا وقت الاختبار، خصوصًا مع أدوات
// زي ngrok/cloudflare tunnel) كانت بتلغي كل الجلسات المفتوحة فورًا لكل المستخدمين، حتى لو
// المستخدمة داخلة من ثانية واحدة بس - وده كان بيظهر كـ "401 انتهت صلاحية الجلسة" مفاجئ
// من غير أي سبب ظاهر من ناحيتها. الحل: لو مفيش JWT_SECRET فى .env، نولّد سر عشوائي **مرة
// واحدة بس** ونحفظه فى ملف محلي (.jwt_secret) ونعيد استخدامه فى كل مرة السيرفر يشتغل تاني -
// فالجلسات تفضل شغالة حتى بعد إعادة التشغيل. الأفضل طبعًا لسه إنك تحددي JWT_SECRET بنفسك
// فى .env، لكن ده بيضمن استقرار الجلسات حتى لو ماعملتيش كده.
function getOrCreatePersistedJwtSecret(){
  const secretFile=path.join(__dirname,'.jwt_secret');
  try{
    if(fs.existsSync(secretFile)){
      const existing=fs.readFileSync(secretFile,'utf8').trim();
      if(existing) return existing;
    }
  }catch(e){ console.warn('⚠️ تعذّرت قراءة ملف .jwt_secret المحفوظ:',e.message); }
  const generated=require('crypto').randomBytes(32).toString('hex');
  try{ fs.writeFileSync(secretFile,generated,'utf8'); }
  catch(e){ console.warn('⚠️ تعذّر حفظ .jwt_secret على القرص - السر هيتولّد تاني كل إعادة تشغيل:',e.message); }
  return generated;
}
if(!process.env.JWT_SECRET){
  console.warn('⚠️  تحذير أمان: JWT_SECRET غير محدد في .env — تم توليد/استخدام سر محفوظ محليًا في .jwt_secret بدلاً منه (الأفضل تحدديه بنفسك في .env).');
}
const JWT_SECRET=process.env.JWT_SECRET||getOrCreatePersistedJwtSecret();
const JWT_EXPIRES_IN='12h';

function signToken(u){
  return jwt.sign({id:u.UserID,name:u.FullName,dept:u.Department,action:u.Permission},JWT_SECRET,{expiresIn:JWT_EXPIRES_IN});
}
// middleware: يتحقق من وجود توكن صالح في الهيدر Authorization: Bearer <token>
function requireAuth(req,res,next){
  const authHeader=req.headers['authorization']||'';
  const token=authHeader.startsWith('Bearer ')?authHeader.slice(7):null;
  if(!token) return res.status(401).json({error:'يجب تسجيل الدخول أولاً'});
  try{
    req.user=jwt.verify(token,JWT_SECRET);
    next();
  }catch(e){
    return res.status(401).json({error:'انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مرة أخرى'});
  }
}

// ══════════════════════════════════════════════════════════════════
// صلاحيات الحذف/التعديل بسبب - تُستخدم في كل أزرار الحذف/التعديل
// الظاهرة بجانب نتائج البحث (بيانات إدارية/آخر حدث/بيانات شاملة)
// القاعدة: المدير (admin) وصاحب صلاحية "كل الإدارات" يقدروا يديروا أي سجل.
//   غيرهم يقدر بس يدير سجلات إدارته هو (نفس إدارة اللي سجّلت البيانات).
//   لو السجل قديم ومفيهوش إدارة مسجَّلة (Department=NULL) فالحذف/التعديل
//   يبقى مقصور على المدير فقط، حفاظًا على الأمان.
// ══════════════════════════════════════════════════════════════════
function isPrivilegedUser(u){ return !!u && (u.action==='admin' || u.dept==='كل الإدارات'); }

// يتحقق من صلاحية إدارة (تعديل/حذف) سجل في جدول عنده عمود Department
async function assertCanManageDeptRecord(u, table, idCol, id){
  if(!u || !u.id) return {ok:false,error:'يجب تسجيل الدخول'};
  if(!id || isNaN(id)) return {ok:false,error:'معرّف السجل غير صحيح'};
  const conn=await db();
  let r;
  try{
    r=await conn.request().input('id',sql.Int,id).query(`SELECT Department,CreatedBy FROM ${table} WHERE ${idCol}=@id`);
  }catch(e){
    // لو لسه في مشكلة بنية قاعدة بيانات (مثلاً حساب الاتصال بقاعدة البيانات معندوش صلاحية
    // ALTER TABLE فمنعت الإصلاح التلقائي في ensureSchema) - منسمحش لمشكلة تقنية في القاعدة
    // إنها توقف كل المستخدمين عن التعديل زي ما كان بيحصل قبل كده. نسمح بالعملية ونسجّل تحذير.
    console.warn(`⚠️ فشل فحص صلاحية الإدارة على ${table} (${e.message}) - تم السماح بالعملية احتياطيًا`);
    return {ok:true};
  }
  if(!r.recordset.length) return {ok:false,error:'السجل غير موجود'};
  if(isPrivilegedUser(u)) return {ok:true};
  const recDept=r.recordset[0].Department;
  const recCreatedBy=r.recordset[0].CreatedBy;
  if(!recDept){
    // سجل قديم اتسجل قبل ربط الإدارة تلقائيًا بالسجل (باج تم إصلاحه) - لسه نسمح لصاحب السجل
    // الأصلي (اللي سجّله) بالتعديل/الحذف، بدل ما نمنعها بالكامل إلا على المدير العام فقط.
    if(recCreatedBy && recCreatedBy===u.id) return {ok:true};
    return {ok:false,error:'هذا سجل قديم غير مرتبط بإدارة محددة - التعديل/الحذف مقصور على المدير العام'};
  }
  if(u.dept!==recDept) return {ok:false,error:`لا تملك صلاحية التعديل/الحذف - هذا السجل خاص بإدارة (${recDept}) وليس إدارتك (${u.dept||'—'})`};
  return {ok:true};
}

// يتحقق من صلاحية إدارة البيانات الثابتة للجمعية نفسها (الاسم/الحالة/رئيس المجلس...)
// مقصورة على المدير العام أو إدارة القيد (صاحبة بيانات الجمعية الأساسية)
function assertCanManageOrg(u){
  if(!u || !u.id) return {ok:false,error:'يجب تسجيل الدخول'};
  if(isPrivilegedUser(u) || u.dept==='القيد') return {ok:true};
  return {ok:false,error:'تعديل البيانات الثابتة للجمعية أو حذفها مقصور على المدير العام أو إدارة القيد'};
}

// ══ رفع ملفات التقارير (PDF/Excel) وتنزيلها ══
const UPLOAD_DIR=path.join(__dirname,'uploads');
if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR,{recursive:true});
app.use('/uploads',express.static(UPLOAD_DIR));
// ملاحظة: مسار الملفات ده لسه من غير حماية توكن عمداً، لأن الواجهة بتفتح الملفات
// كروابط عادية (target="_blank") من غير ما تقدر ترفق هيدر Authorization معاها.
// يعني: أي حد عنده رابط الملف المباشر (اسم عشوائي + طابع زمني) يقدر يفتحه.
// ده أقل خطورة من مشكلة الكتابة/التعديل اللي اتصلحت، لكن لو عايز حماية كاملة
// للمستندات لازم تتحول لكوكي جلسة (session cookie) بدل التوكن، أو رابط تنزيل موقّع مؤقت.

// أنواع الملفات المسموح برفعها فقط (تقارير PDF/Excel/Word وصور مستندات)
const ALLOWED_UPLOAD_EXT=new Set(['.pdf','.xls','.xlsx','.doc','.docx','.jpg','.jpeg','.png']);
const ALLOWED_UPLOAD_MIME=new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg','image/png'
]);
const upload=multer({
  storage:multer.diskStorage({
    destination:(req,file,cb)=>cb(null,UPLOAD_DIR),
    filename:(req,file,cb)=>{
      // (تصحيح) الأسماء القديمة كانت بتحتفظ بالحروف العربية زي ما هي في اسم الملف على
      // القرص - ده بيسبب مشاكل حقيقية لما يتحول لرابط (URL) خصوصًا لو الرابط ده اتحط جوه
      // ملف Excel مُصدَّر (Excel بيرفض يفتح روابط فيها حروف عربية غير مُرمَّزة أصلاً).
      // دلوقتي بنولّد اسم ملف آمن بالكامل (ASCII فقط) على القرص/في الرابط، مع الاحتفاظ
      // بالاسم الأصلي بالعربي منفصل في originalName عشان يتعرض للمستخدم زي ما هو.
      const ext=path.extname(file.originalname||'').toLowerCase();
      const base=path.basename(file.originalname||'',path.extname(file.originalname||''))
        .replace(/[^\w.\-]/g,'_').slice(0,60) || 'file';
      const safe=Date.now()+'_'+base+ext;
      cb(null,safe);
    }
  }),
  limits:{fileSize:20*1024*1024}, // 20MB
  fileFilter:(req,file,cb)=>{
    const ext=path.extname(file.originalname||'').toLowerCase();
    if(!ALLOWED_UPLOAD_EXT.has(ext) || !ALLOWED_UPLOAD_MIME.has(file.mimetype)){
      return cb(new Error('نوع الملف غير مسموح به. الأنواع المسموحة: PDF, Excel, Word, JPG, PNG'));
    }
    cb(null,true);
  }
});
// يُستخدم من نموذج "رفع التقرير": يرفع الملف أولاً ثم يرجع مسار للتخزين مع بيانات التقرير
app.post('/api/upload-report-file',requireAuth,(req,res)=>{
  upload.single('file')(req,res,(err)=>{
    if(err) return res.status(400).json({error:err.message||'تعذر رفع الملف'});
    if(!req.file) return res.status(400).json({error:'لم يتم اختيار ملف'});
    res.json({ok:true,filePath:'/uploads/'+req.file.filename,originalName:req.file.originalname});
  });
});

// (جديد) "إضافة كورقة جديدة لآخر ملف موجود" - بدل ما رفع مستند جديد يستبدل القديم بالكامل،
// الميزة دي بتضيف محتوى الملف الجديد كصفحة/صفحات إضافية في آخر نفس الملف، فيفضل "ملف واحد"
// بيكبر مع الوقت بدل ما يتكرر. بتشتغل مع PDF والصور (jpg/png) بس - أي منهم مع أي منهم، لأنهم
// الصيغ الوحيدة اللي ممكن تتحول/تتدمج كـ"صفحات" فعليًا من غير برنامج تحويل خارجي على السيرفر.
// ملفات Word/Excel (doc/docx/xls/xlsx) مش مدعومة هنا - مفيش طريقة موثوقة تتحول لصفحة PDF
// من غير أداة تحويل مكتبية (زي LibreOffice) مش متوفرة، فبنرفض بوضوح بدل ما نعمل حاجة غلط.
app.post('/api/append-page',requireAuth,(req,res)=>{
  upload.single('file')(req,res,async(err)=>{
    if(err) return res.status(400).json({error:err.message||'تعذر رفع الملف'});
    if(!req.file) return res.status(400).json({error:'لم يتم اختيار ملف'});
    const newFilePath=req.file.path;
    try{
      const existingRel=(req.body.existingPath||'').trim();
      // حماية من path traversal: لازم يبدأ بـ /uploads/ ويفضل جوّه نفس المجلد بالظبط
      if(!existingRel.startsWith('/uploads/') || existingRel.includes('..')){
        fs.unlinkSync(newFilePath);
        return res.status(400).json({error:'مسار الملف الحالي غير صالح'});
      }
      const existingAbs=path.join(UPLOAD_DIR,path.basename(existingRel));
      if(!fs.existsSync(existingAbs)){
        // (تصحيح) لو "المستند الحالي" المسجَّل في قاعدة البيانات مش موجود فعليًا على السيرفر
        // (اتمسح، أو اتنقل، أو مسار قديم من نقل/استيراد بيانات) - فمفيش حاجة أصلاً نحاول ندمج
        // معاها. قبل كده كنا بنوقف الحفظ بالكامل برسالة خطأ رغم إن المستخدمة من وجهة نظرها
        // "مفيش مستند خالص" على الحالة دي. الحل الصح: نرفع الملف الجديد عادي (استبدال/تسجيل
        // أول مستند) من غير ما نحاول ندمج مع حاجة مش موجودة أصلاً.
        return res.json({ok:true,filePath:'/uploads/'+req.file.filename,note:'المستند القديم المسجَّل لم يعد موجودًا على السيرفر - تم رفع الملف الجديد كمستند مستقل بدل الدمج'});
      }
      const extOf=p=>path.extname(p).toLowerCase();
      const existExt=extOf(existingAbs), newExt=extOf(newFilePath);
      const PDF_OK=new Set(['.pdf']), IMG_OK=new Set(['.jpg','.jpeg','.png']);
      if(!PDF_OK.has(existExt) && !IMG_OK.has(existExt)){
        fs.unlinkSync(newFilePath);
        return res.status(400).json({error:'الملف الحالي مش PDF ولا صورة - مينفعش نضيفله ورقة تلقائيًا، لازم تستبدليه بالكامل بدل الإضافة'});
      }
      if(!PDF_OK.has(newExt) && !IMG_OK.has(newExt)){
        fs.unlinkSync(newFilePath);
        return res.status(400).json({error:'الملف الجديد لازم يكون PDF أو صورة (JPG/PNG) عشان يتضاف كورقة - ملفات Word/Excel مش مدعومة هنا'});
      }
      const merged=await PDFDocument.create();
      // ١) محتوى الملف الحالي أولاً (بيفضل هو الأساس، والجديد بيتضاف بعده كآخر صفحة/صفحات)
      await appendFileAsPages(merged,existingAbs,existExt,'الحالي (القديم)');
      // ٢) بعده محتوى الملف المرفوع الجديد
      await appendFileAsPages(merged,newFilePath,newExt,'الجديد (اللي بترفعيه دلوقتي)');
      const mergedBytes=await merged.save();
      const mergedName=Date.now()+'_merged.pdf';
      const mergedAbs=path.join(UPLOAD_DIR,mergedName);
      // (تصحيح) كانت بتستخدم fs.writeFileSync/unlinkSync - النسخة الـ Sync دي بتوقف
      // الـ Node event loop بالكامل لحد ما تخلص، يعني أي طلب تاني (حتى من مستخدمين تانيين
      // ومالوش أي علاقة بالدمج) بيتجمد معاها. استخدام fs.promises بيخلي السيرفر يفضل
      // يرد على باقي الطلبات أثناء كتابة الملف المدموج.
      await fs.promises.writeFile(mergedAbs,mergedBytes);
      await fs.promises.unlink(newFilePath); // مش محتاجين نسيب نسخة الرفع المؤقتة منفصلة بعد الدمج
      res.json({ok:true,filePath:'/uploads/'+mergedName});
    }catch(e){
      try{ await fs.promises.unlink(newFilePath); }catch(_){}
      res.status(500).json({error:'تعذّر دمج الملفات: '+e.message});
    }
  });
});
// whichLabel بيتحط في رسالة الخطأ عشان نعرف بالظبط أي ملف (الحالي ولا الجديد) اللي فشل فيه الدمج
async function appendFileAsPages(mergedDoc,absPath,ext,whichLabel){
  // (تصحيح) نفس مشكلة الـ Sync - قراءة async عشان ميقفش السيرفر كله وقت القراءة
  const bytes=await fs.promises.readFile(absPath);
  try{
    if(ext==='.pdf'){
      // ignoreEncryption:true: بعض ملفات الـ PDF (خصوصًا الممسوحة ضوئيًا من ماسحات/تطبيقات معينة)
      // بتتحفظ بحماية/تشفير بسيط حتى لو من غير باسورد فعلي للفتح - من غيرها pdf-lib كان بيرفض
      // يفتح الملف تمامًا ويوقف الدمج، حتى لو الملف سليم 100% وقابل للفتح عادي في أي قارئ PDF.
      const src=await PDFDocument.load(bytes,{ignoreEncryption:true});
      const pages=await mergedDoc.copyPages(src,src.getPageIndices());
      pages.forEach(p=>mergedDoc.addPage(p));
    } else {
      const img = ext==='.png' ? await mergedDoc.embedPng(bytes) : await mergedDoc.embedJpg(bytes);
      const page=mergedDoc.addPage([img.width,img.height]);
      page.drawImage(img,{x:0,y:0,width:img.width,height:img.height});
    }
  }catch(e){
    // (جديد) رسالة خطأ واضحة تقول أي ملف بالظبط اللي فيه المشكلة (الحالي ولا الجديد) بدل
    // رسالة عامة "تعذّر الدمج" ملهاش معنى للمستخدمة - يوضح هل الملف تالف أو صيغته مش مدعومة فعليًا
    throw new Error(`تعذّر قراءة الملف ${whichLabel||''} كـ ${ext==='.pdf'?'PDF':'صورة'} - الملف ممكن يكون تالف أو الصيغة مش مدعومة فعليًا (${e.message})`);
  }
}

const cfg={server:process.env.DB_SERVER||'localhost',database:process.env.DB_NAME||'NGO_System',
  user:process.env.DB_USER||'node_user',password:process.env.DB_PASSWORD||'',
  options:{encrypt:false,trustServerCertificate:true}};
let pool;
let schemaEnsured=false;
// ══════════════════════════════════════════════════════════════════════
// إصلاح جذري: التعديل/الحذف كان بيفشل لكل المستخدمين على حد سواء (سواء
// صاحب الإدارة أو المدير العام أو أي صلاحية) لأن أعمدة Department/CreatedBy
// (وأعمدة الحذف الناعم IsDeleted/DeleteReason/DeletedBy/DeletedAt) اللي
// بيعتمد عليها كل كود التعديل والحذف والإحصاء، كانت مُضافة بس في ملف ترقية
// SQL منفصل (رقم 20) - ولو الترقية دي ما اتنفذتش فعليًا على قاعدة البيانات
// (أو اتنفذت جزئيًا)، فكل استعلام بيحاول يقرأ أو يكتب في هذه الأعمدة كان
// بيفشل بخطأ "Invalid column name" من قاعدة البيانات نفسها - قبل ما نوصل
// حتى لفحص صلاحيات المستخدم، فكان بيبان إن "التعديل مش شغال خالص" لأي حد.
// بدل ما نُبقي الإصلاح معلّق على تنفيذ ملف SQL يدويًا، السيرفر دلوقتي
// بيتأكد بنفسه من وجود كل عمود مطلوب أول ما يتصل بقاعدة البيانات (مرة واحدة
// فقط لكل تشغيل)، ويضيفه تلقائيًا لو ناقص - فمفيش داعي تشغّلي أي SQL يدوي
// تاني، والنظام بيشتغل صح حتى لو قاعدة البيانات قديمة.
// ══════════════════════════════════════════════════════════════════════
async function ensureSchema(p){
  // (جديد) إدارة "تقرير تفتيش الجمعيات" - الجدول ده جديد بالكامل فبننشئه هنا لو مش موجود
  try{
    await p.request().query(`IF OBJECT_ID('InspectionReports','U') IS NULL
BEGIN
  CREATE TABLE InspectionReports (
    ReportID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    Scope NVARCHAR(20) NOT NULL,
    YearFrom INT NOT NULL, YearTo INT NOT NULL,
    AuditorName NVARCHAR(200),
    OpeningBalance DECIMAL(18,2), Revenue DECIMAL(18,2), Expenses DECIMAL(18,2), ClosingBalance DECIMAL(18,2),
    CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(), IsDeleted BIT DEFAULT 0
  );
END`);
  }catch(e){ console.warn(`⚠️ تعذّر التأكد من جدول InspectionReports: ${e.message}`); }
  const addCol=async(table,col,def)=>{
    try{
      await p.request().query(`IF COL_LENGTH('${table}','${col}') IS NULL ALTER TABLE ${table} ADD ${col} ${def};`);
    }catch(e){
      console.warn(`⚠️ تعذّر التأكد من عمود ${table}.${col}: ${e.message}`);
    }
  };
  const adminTables=['Grants','Projects','Legislations','BannedOrgs','InspectionReports'];
  for(const t of adminTables){
    await addCol(t,'Department','NVARCHAR(100) NULL');
    await addCol(t,'CreatedBy','INT NULL');
    await addCol(t,'IsDeleted','BIT NOT NULL DEFAULT 0');
    await addCol(t,'DeleteReason','NVARCHAR(500) NULL');
    await addCol(t,'DeletedBy','INT NULL');
    await addCol(t,'DeletedAt','DATETIME NULL');
  }
  await addCol('FundraisingLicenses','Department','NVARCHAR(100) NULL');
  await addCol('Grants','GrantNumber','NVARCHAR(100) NULL');
  await addCol('BannedOrgs','IsBanned','BIT DEFAULT 0');
  await addCol('BannedOrgs','DissolutionInProgress','BIT DEFAULT 0');
  // (جديد) ربط مستند "آخر حدث" ببيانات الإدارة: لو المستخدم رفع مستند وهو بيسجّل حدث
  // مربوط ببيانات إدارية حقيقية (ترخيص/منحة/مشروع/قرار/حظر/تقرير تفتيش) في نفس الوقت،
  // بيتحفظ مسار نفس المستند هنا كمان - عشان يبان في البحث الإداري لهذا السجل تحديدًا،
  // مش بس في سجل الحدث العام. لو مفيش بيانات إدارية اتسجلت مع الحدث، العمود ده فاضل NULL.
  for(const t of ['FundraisingLicenses','Grants','Projects','Legislations','BannedOrgs','InspectionReports']){
    await addCol(t,'FilePath','NVARCHAR(1000) NULL');
  }
  // (جديد) دمج جمعية مكررة (مثلاً كانت مديرية واتسجّلت غلط مرة تانية كمركزية) في جمعية أخرى
  // موجودة فعلاً: كل سجل بيانات إدارية بينتقل بيتعلّم بملحوظة توضيحية في هذا العمود.
  for(const t of ['FundraisingLicenses','Grants','Projects','Legislations','BannedOrgs','InspectionReports','OrgEvents','Documents']){
    await addCol(t,'MergeNote','NVARCHAR(500) NULL');
  }
  await addCol('Organizations','MergedIntoOrgID','INT NULL');
  await addCol('Organizations','MergedNote','NVARCHAR(500) NULL');
  await addCol('Organizations','MergedAt','DATETIME NULL');
  // نرجّع نملأ Department للسجلات القديمة اللي اتسجلت قبل وجود العمود، من إدارة اللي سجّلها
  for(const t of adminTables){
    try{
      await p.request().query(`UPDATE t SET t.Department = u.Department
        FROM ${t} t JOIN Users u ON u.UserID = t.CreatedBy
        WHERE t.Department IS NULL AND t.CreatedBy IS NOT NULL AND u.Department IS NOT NULL;`);
    }catch(e){ console.warn(`⚠️ تعذّر تعبئة Department القديمة لجدول ${t}: ${e.message}`); }
  }
  try{
    await p.request().query(`UPDATE fl SET fl.Department = u.Department
      FROM FundraisingLicenses fl JOIN Users u ON u.UserID = fl.CreatedBy
      WHERE fl.Department IS NULL AND fl.CreatedBy IS NOT NULL AND u.Department IS NOT NULL;`);
  }catch(e){ console.warn(`⚠️ تعذّر تعبئة Department القديمة لتراخيص جمع المال: ${e.message}`); }

  // ══════════════════════════════════════════════════════════════════════
  // (جديد - إصلاح أداء) IsActive/DeletedAt (في Organizations) وIsDeleted (في
  // FundraisingLicenses) بيتفلتر بيهم في WHERE كل استعلام تقريبًا (organizations,
  // licenses, stats/general..) لكن ماكانش عليهم أي index أصلاً - يعني كل طلب كان
  // بيعمل full table scan على كل الجدول، وده كان بيبقى أبطأ وأبطأ كل ما عدد
  // الجمعيات/التراخيص يزيد. الـ indexes دي بتتضاف مرة واحدة بس (IF NOT EXISTS)
  // زي باقي فحوصات ensureSchema، فمفيش داعي تشغّلي SQL يدوي أو تعيدي الاستيراد.
  // ══════════════════════════════════════════════════════════════════════
  try{
    await p.request().query(`IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_Org_Active_Deleted' AND object_id=OBJECT_ID('Organizations'))
      CREATE INDEX IX_Org_Active_Deleted ON Organizations(DeletedAt, IsActive);`);
  }catch(e){ console.warn(`⚠️ تعذّر إنشاء IX_Org_Active_Deleted: ${e.message}`); }
  try{
    await p.request().query(`IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_Lic_IsDeleted' AND object_id=OBJECT_ID('FundraisingLicenses'))
      CREATE INDEX IX_Lic_IsDeleted ON FundraisingLicenses(IsDeleted);`);
  }catch(e){ console.warn(`⚠️ تعذّر إنشاء IX_Lic_IsDeleted: ${e.message}`); }
}
async function db(){
  if(!pool)pool=await sql.connect(cfg);
  if(!schemaEnsured){ schemaEnsured=true; await ensureSchema(pool); }
  return pool;
}

// AUTH
// ملاحظة أمان: كلمة المرور (PIN) لم تعد تُقارن كنص صريح في قاعدة البيانات.
// يتم التحقق منها عبر bcrypt مقابل عمود PasswordHash. للمستخدمين القدامى الذين
// لا يزال عندهم PIN نص صريح فقط (قبل هذا التحديث)، يتم التحقق منه مرة واحدة
// ثم ترحيله فورًا إلى Hash ومسح النص الصريح تلقائيًا (بدون أي تدخل يدوي).
app.post('/api/login',async(req,res)=>{try{
  const{name,pin}=req.body;
  if(!name||!pin) return res.status(400).json({error:'من فضلك أدخل الاسم وكلمة المرور'});
  const d=await db();
  const r=await d.request().input('n',sql.NVarChar,name)
    .query('SELECT* FROM Users WHERE FullName=@n AND IsApproved=1 AND IsActive=1');
  if(!r.recordset.length)return res.status(401).json({error:'كلمة المرور غير صحيحة'});
  const u=r.recordset[0];

  let ok=await verifyPin(pin,u.PasswordHash);
  if(!ok && !u.PasswordHash && u.PIN && String(u.PIN)===String(pin)){
    // مستخدم قديم: عنده PIN نص صريح بس - نتحقق منه ثم نرحّله فورًا إلى Hash
    ok=true;
    const newHash=await hashPin(pin);
    await d.request().input('id',sql.Int,u.UserID).input('ph',sql.NVarChar,newHash)
      .query('UPDATE Users SET PasswordHash=@ph, PIN=NULL WHERE UserID=@id');
  }
  if(!ok)return res.status(401).json({error:'كلمة المرور غير صحيحة'});

  const token=signToken(u);
  res.json({ok:true,token,user:{id:u.UserID,name:u.FullName,dept:u.Department,action:u.Permission}});
}catch(e){res.status(500).json({error:e.message});}});

// جلب المستخدمين المعتمدين لقائمة تسجيل الدخول
app.get('/api/users/approved',async(req,res)=>{try{
  const r=await(await db()).request()
    .query('SELECT UserID,FullName,Department,Permission FROM Users WHERE IsApproved=1 AND IsActive=1 ORDER BY FullName');
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});



app.post('/api/register-request',async(req,res)=>{try{
  const{fullName,nationalID,department,permission}=req.body;
  await(await db()).request().input('n',sql.NVarChar,fullName).input('ni',sql.NVarChar,nationalID)
    .input('d',sql.NVarChar,department).input('p',sql.NVarChar,permission)
    .query('INSERT INTO RegistrationRequests(FullName,NationalID,Department,Permission)VALUES(@n,@ni,@d,@p)');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════════════════════
// (جديد) زر "تسجيل جمعية جديدة" العام - متاح لأي شخص بدون تسجيل دخول.
// المستخدم يكتب اسمه ورقمه القومي فقط (بدون حساب/PIN) عشان يقدر يتابع طلبه لاحقاً
// من "طلباتي" العامة بنفس الاسم والرقم القومي.
// IsFirstTime=1 ⇐ جمعية جديدة فعلاً لأول مرة: رقم القيد مش مطلوب، وفحص التكرار لا يطبَّق
//   (لسه معندهاش رقم قيد حقيقي أصلاً).
// IsFirstTime=0 ⇐ جمعية موجودة من قبل بس مش متسجلة عندنا: رقم القيد إجباري، وفحص
//   التكرار برضه لا يُطبَّق هنا (حسب الطلب) - إدارة القيد هي اللي تحسم التكرار وقت المراجعة.
// ══════════════════════════════════════════════════════════════════
app.post('/api/add-request-guest',async(req,res)=>{try{
  const d=req.body;
  const submitterName=(d.SubmitterName||'').trim();
  const submitterNid=(d.SubmitterNationalID||'').trim();
  const isFirstTime = d.IsFirstTime===true || d.IsFirstTime==='true' || d.IsFirstTime===1 || d.IsFirstTime==='1';
  if(!submitterName) return res.status(400).json({error:'اسم مقدّم الطلب إجباري'});
  if(!submitterNid || submitterNid.length!==14) return res.status(400).json({error:'الرقم القومي لمقدّم الطلب إجباري ويجب أن يكون 14 رقم بالظبط'});
  if(!d.OrgName || !(d.OrgName+'').trim()) return res.status(400).json({error:'اسم الجمعية إجباري'});
  if(!isFirstTime && !(d.RegNum+'').trim()) return res.status(400).json({error:'رقم القيد إجباري عندما لا تكون هذه أول مرة'});
  const regYear=parseInt(d.RegYear)||null;
  const insertOnce=()=>(db()).then(conn=>conn.request()
    .input('nm',sql.NVarChar,d.OrgName).input('tp',sql.NVarChar,d.OrgType||null)
    .input('rn',sql.NVarChar,isFirstTime?null:d.RegNum).input('ry',sql.Int,regYear).input('gv',sql.NVarChar,d.Governorate||null)
    .input('ad',sql.NVarChar,d.Address||null).input('wf',sql.NVarChar,d.WorkField||null)
    .input('ch',sql.NVarChar,d.Chairman||null).input('ph',sql.NVarChar,d.Phone||null)
    .input('sn',sql.NVarChar,submitterName).input('sni',sql.NVarChar,submitterNid).input('ift',sql.Bit,isFirstTime?1:0)
    .query(`INSERT INTO AddRequests(OrgName,OrgType,RegNum,RegYear,Governorate,Address,WorkField,Chairman,Phone,SubmitterName,SubmitterNationalID,IsFirstTime,RequestedBy)
      OUTPUT INSERTED.ReqID VALUES(@nm,@tp,@rn,@ry,@gv,@ad,@wf,@ch,@ph,@sn,@sni,@ift,NULL)`));
  try{
    const r=await insertOnce();
    res.json({ok:true,ReqID:r.recordset[0].ReqID});
  }catch(e){
    if(e.message.includes('Invalid column name')){
      const conn=await db();
      await conn.request().query(`IF COL_LENGTH('AddRequests','SubmitterName') IS NULL ALTER TABLE AddRequests ADD SubmitterName NVARCHAR(200) NULL;`);
      await conn.request().query(`IF COL_LENGTH('AddRequests','SubmitterNationalID') IS NULL ALTER TABLE AddRequests ADD SubmitterNationalID NVARCHAR(20) NULL;`);
      await conn.request().query(`IF COL_LENGTH('AddRequests','IsFirstTime') IS NULL ALTER TABLE AddRequests ADD IsFirstTime BIT NULL;`);
      const r2=await insertOnce();
      res.json({ok:true,ReqID:r2.recordset[0].ReqID});
    } else throw e;
  }
}catch(e){res.status(500).json({error:e.message});}});

// (جديد) "طلباتي" العامة بدون تسجيل دخول - يبحث بالاسم + الرقم القومي بالظبط
// (نفس الاسم والرقم القومي اللي كتبهم وقت إرسال الطلب) ويرجّع حالة الطلب/الطلبات.
app.get('/api/add-requests/lookup',async(req,res)=>{try{
  const name=((req.query.name)||'').trim();
  const nid=((req.query.nationalId)||'').trim();
  if(!name || !nid) return res.status(400).json({error:'الاسم والرقم القومي إجباريان للبحث'});
  const conn=await db();
  let r;
  try{
    r=await conn.request().input('nm',sql.NVarChar,name).input('ni',sql.NVarChar,nid)
      .query(`SELECT ReqID,OrgName,Status,CreatedAt,IsFirstTime FROM AddRequests
        WHERE LTRIM(RTRIM(SubmitterNationalID))=@ni AND LTRIM(RTRIM(LOWER(SubmitterName)))=LTRIM(RTRIM(LOWER(@nm)))
        ORDER BY CreatedAt DESC`);
  }catch(e){
    if(e.message.includes('Invalid column name')) return res.json({found:false,requests:[]}); // لسه ولا طلب اتسجل بالعمود الجديد
    throw e;
  }
  res.json({found:r.recordset.length>0,requests:r.recordset});
}catch(e){res.status(500).json({error:e.message});}});

// ══ من هنا فصاعداً: كل المسارات تتطلب تسجيل دخول (توكن صالح) ══
// أي مسار جديد يُضاف تحت هذا السطر هيبقى محمي تلقائياً - لا تضيف مسارات جديدة فوق هذا السطر إلا لو لازم تبقى عامة (زي login)
app.use(requireAuth);

// ORGANIZATIONS
app.get('/api/organizations',async(req,res)=>{try{
  const{search,level,type,gov,regNum,fromYear,toYear,ids,includePendingReview,status,lite}=req.query;
  const d=await db();const r=d.request();
  // ملاحظة: البحث الإداري محتاج يشوف كمان الجمعيات اللي لسه Status='تحتاج مراجعة' لأن بياناتها
  // الإدارية (تراخيص/منح/إلخ) ممكن تكون اتقبلت فعلاً حتى لو تسجيل الجمعية نفسها لسه معلّق مراجعته.
  // ملاحظة (تعديل): بنرجّع كل أعمدة جدول Organizations (مش بس اللي بتتعرض في جدول البحث) عشان
  // زرار تصدير الإكسيل يقدر ينزّل البيانات كاملة حتى لو مش كلها ظاهرة للمستخدم في الشاشة.
  //
  // (جديد v30) lite=1: يرجّع بس الأعمدة اللي فعليًا بتتعرض في شاشات البحث/الفلترة والتحقق من
  // التكرار (مش تصدير الإكسيل) - المستخدَمة في تحميل القائمة الكاملة عند فتح الموقع (ORGS/ORGS_ADMIN).
  // ده بيقلل حجم الرد بشكل كبير جدًا (بيستبعد أعمدة نصية كبيرة زي Notes/PreviousName/إلخ مش
  // محتاجينها إلا وقت تصدير نتائج بحث معينة، ووقتها بيتم جلبها كاملة بالتحديد لهذه النتائج فقط
  // - راجعي exportSearchExcel/exportAdminSearchExcel في كود الواجهة). الوضع الافتراضي (من غير
  // lite) فضل بالظبط زي ما هو من غير أي تغيير، عشان أي استخدام تاني للـ API متأثرش خالص.
  const isLite = String(lite)==='1';
  let q = isLite
    ? `SELECT OrgID,OrgName,OrgType,RegNum,RegYear,Level,Address,Governorate,Status,WorkField,
         UnifiedNumber,LevelChangeNote,DissolutionDate,MergedIntoOrgID,
         DirFlagSuspended,DirFlagNote,DirFlagAt
       FROM Organizations WHERE (IsActive=1 OR MergedIntoOrgID IS NOT NULL) AND DeletedAt IS NULL`
    : `SELECT OrgID,OrgName,OrgType,RegNum,RegYear,UnifiedNumber,Level,Address,Governorate,Directorate,
    Chairman,Phone,WorkField,PublicBenefit,PublicBenefitDecree,PublicBenefitYear,Status,
    NameChanged,PreviousName,PreviousGov,NameChangeDate,
    PrevRegNum,PrevRegYear,PrevGovTransfer,TransferDate,NewRegNum,NewRegYear,NewGovTransfer,
    Notes,CreatedAt,CreatedBy,
    LevelChangeNote,LevelChangeDate,DissolutionDate,MergedIntoOrgID,MergedNote,
    DirFlagSuspended,DirFlagNote,DirFlagBy,DirFlagAt
    FROM Organizations WHERE (IsActive=1 OR MergedIntoOrgID IS NOT NULL) AND DeletedAt IS NULL`;
  if(String(includePendingReview)!=='1' && status!=='تحتاج مراجعة') q+=' AND ISNULL(Status,N\'\')<>N\'تحتاج مراجعة\'';
  if(ids){
    const idList=String(ids).split(',').map(x=>parseInt(x)).filter(Number.isFinite);
    if(!idList.length) return res.json([]);
    q+=` AND OrgID IN (${idList.join(',')})`;
  }
  if(search){q+=' AND(OrgName LIKE @s OR CAST(RegNum AS NVARCHAR)LIKE @s)';r.input('s',sql.NVarChar,'%'+search+'%');}
  if(level){q+=' AND Level=@lv';r.input('lv',sql.NVarChar,level);}
  if(type){q+=' AND OrgType=@tp';r.input('tp',sql.NVarChar,type);}
  if(gov){q+=' AND Governorate=@gv';r.input('gv',sql.NVarChar,gov);}
  if(regNum){q+=' AND RegNum=@rn';r.input('rn',sql.Int,parseInt(regNum));}
  if(fromYear){q+=' AND RegYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
  if(toYear){q+=' AND RegYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
  if(status){q+=' AND Status=@st';r.input('st',sql.NVarChar,status);} // (جديد) لدعم إحصاء الشاشة الرئيسية (موقوفة/رجعت لممارسة النشاط/تحتاج مراجعة)
  if(String(req.query.dirFlag||'')==='1') q+=' AND DirFlagSuspended=1'; // (جديد) فلتر إحصاء "جمعيات حددها المدير للإيقاف"
  q+=' ORDER BY RegNum';
  const attachMergedNames=async(rows)=>{
    const mergedIds=[...new Set(rows.filter(r=>r.MergedIntoOrgID).map(r=>r.MergedIntoOrgID))];
    if(!mergedIds.length) return rows;
    const tgts=(await d.request().query(`SELECT OrgID,OrgName,RegNum,RegYear FROM Organizations WHERE OrgID IN (${mergedIds.join(',')})`)).recordset;
    const byId={}; tgts.forEach(t=>byId[t.OrgID]=t);
    rows.forEach(r=>{ if(r.MergedIntoOrgID && byId[r.MergedIntoOrgID]){ const t=byId[r.MergedIntoOrgID]; r.MergedIntoOrgName=t.OrgName; r.MergedIntoRegNum=t.RegNum; r.MergedIntoRegYear=t.RegYear; } });
    return rows;
  };
  try{
    res.json(await attachMergedNames((await r.query(q)).recordset));
  }catch(e){
    if(e.message.includes('Invalid column name')){
      await d.request().query(`IF COL_LENGTH('Organizations','LevelChangeNote') IS NULL ALTER TABLE Organizations ADD LevelChangeNote NVARCHAR(500) NULL;`);
      await d.request().query(`IF COL_LENGTH('Organizations','LevelChangeDate') IS NULL ALTER TABLE Organizations ADD LevelChangeDate DATE NULL;`);
      await d.request().query(`IF COL_LENGTH('Organizations','DissolutionDate') IS NULL ALTER TABLE Organizations ADD DissolutionDate DATE NULL;`);
      await d.request().query(`IF COL_LENGTH('Organizations','MergedIntoOrgID') IS NULL ALTER TABLE Organizations ADD MergedIntoOrgID INT NULL;`);
      await d.request().query(`IF COL_LENGTH('Organizations','MergedNote') IS NULL ALTER TABLE Organizations ADD MergedNote NVARCHAR(500) NULL;`);
      res.json(await attachMergedNames((await r.query(q)).recordset));
    } else throw e;
  }
}catch(e){res.status(500).json({error:e.message});}});

// ══ بحث برقم تسلسلي الإدارة (مثال: جمع المال ⇐ رقم الترخيص، التشريعات ⇐ رقم القرار، المحظورة ⇐ رقم القضية) ══
// كل إدارة عندها رقم تسلسلي خاص بها بتبحث بيه - ملاحظة: إدارة القيد مستثناة لأن البحث برقم القيد موجود بالفعل ومتاح للجميع
app.get('/api/admin-serial-search',async(req,res)=>{try{
  const{dept,num,year}=req.query;
  if(!dept||!num) return res.json([]);
  const d=await db();const r=d.request();
  r.input('num',sql.NVarChar,'%'+num+'%');
  let q='';
  if(dept==='جمع المال'){
    q=`SELECT DISTINCT o.OrgID, fl.LicenseNumber AS MatchNumber, fl.IssueYear AS MatchYear FROM Organizations o JOIN FundraisingLicenses fl ON fl.OrgID=o.OrgID WHERE fl.LicenseNumber LIKE @num AND ISNULL(fl.IsDeleted,0)=0`;
    if(year){ q+=' AND fl.IssueYear=@yr'; r.input('yr',sql.Int,parseInt(year)); }
  } else if(dept==='التشريعات'){
    q=`SELECT DISTINCT o.OrgID, l.DecreeNumber AS MatchNumber, CAST(NULL AS INT) AS MatchYear FROM Organizations o JOIN Legislations l ON l.OrgID=o.OrgID WHERE l.DecreeNumber LIKE @num AND ISNULL(l.IsDeleted,0)=0`;
  } else if(dept==='المحظورة'){
    q=`SELECT DISTINCT o.OrgID, b.CaseNumber AS MatchNumber, CAST(NULL AS INT) AS MatchYear FROM Organizations o JOIN BannedOrgs b ON b.OrgID=o.OrgID WHERE b.CaseNumber LIKE @num AND ISNULL(b.IsDeleted,0)=0`;
  } else if(dept==='المنظمات'){
    q=`SELECT DISTINCT o.OrgID, CAST(e.OrgEntryID AS NVARCHAR) AS MatchNumber, CAST(NULL AS INT) AS MatchYear FROM Organizations o JOIN OrgGeneralEntries e ON e.OrgID=o.OrgID WHERE CAST(e.OrgEntryID AS NVARCHAR) LIKE @num AND e.IsActive=1`;
  } else if(dept==='المنح'){
    q=`SELECT DISTINCT o.OrgID, g.GrantNumber AS MatchNumber, g.GrantYear AS MatchYear FROM Organizations o JOIN Grants g ON g.OrgID=o.OrgID WHERE g.GrantNumber LIKE @num AND ISNULL(g.IsDeleted,0)=0`;
  } else {
    return res.json([]); // إدارة بدون رقم تسلسلي خاص بها (أو إدارة القيد المستثناة)
  }
  const rs=await r.query(q);
  res.json(rs.recordset); // [{OrgID, MatchNumber, MatchYear}, ...]
}catch(e){
  if(e.message.includes('Invalid column name')){
    try{
      await(await db()).request().query(`IF COL_LENGTH('Grants','GrantNumber') IS NULL ALTER TABLE Grants ADD GrantNumber NVARCHAR(100) NULL;`);
      res.json([]); // العمود اتضاف الآن - أعيدي البحث
    }catch(e2){res.status(500).json({error:e2.message});}
  } else res.status(500).json({error:e.message});
}});

// ══ جمعيات تحتاج مراجعة (Status='تحتاج مراجعة') ══
// دي جمعيات اتقبلت بياناتها الإدارية (من طلب إضافة جمعية) لكن الجمعية نفسها لسه معلّقة
// ومش هتظهر في بحث/قوائم الجمعيات العادية غير بعد ما حد يراجعها ويقبلها من هنا صراحةً.
app.get('/api/organizations/pending-review',async(req,res)=>{try{
  const d=await db();
  const r=await d.request().query(`SELECT OrgID,OrgName,OrgType,RegNum,RegYear,Level,Governorate,WorkField,Chairman,CreatedAt
    FROM Organizations WHERE IsActive=1 AND Status=N'تحتاج مراجعة' ORDER BY CreatedAt DESC`);
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

// قبول/رفض جمعية معلّقة: القبول = تتحول لحالة "نشطة" وتنزل مع باقي الجمعيات في كل الشاشات.
// الرفض = حذف ناعم بسبب (زي باقي أزرار الحذف بسبب في النظام) - قابل للمراجعة لاحقًا مين رفضها وليه.
app.put('/api/organizations/:id/review',async(req,res)=>{try{
  const{decision,reason}=req.body;
  const id=parseInt(req.params.id)||0;
  if(!id) return res.status(400).json({error:'معرّف الجمعية غير صحيح'});
  const d=await db();
  const chk=await d.request().input('id',sql.Int,id).query(`SELECT Status FROM Organizations WHERE OrgID=@id AND IsActive=1`);
  if(!chk.recordset.length) return res.status(404).json({error:'الجمعية غير موجودة'});
  if(chk.recordset[0].Status!=='تحتاج مراجعة') return res.status(409).json({error:'هذه الجمعية ليست في قائمة تحتاج مراجعة (ربما رُوجعت بالفعل)'});
  if(decision==='approve'){
    await d.request().input('id',sql.Int,id).query(`UPDATE Organizations SET Status=N'نشطة' WHERE OrgID=@id`);
    return res.json({ok:true,status:'approved'});
  }
  if(decision==='reject'){
    if(!reason||!String(reason).trim()) return res.status(400).json({error:'سبب الرفض إجباري'});
    await d.request().input('id',sql.Int,id).input('rs',sql.NVarChar,String(reason).trim()).input('by',sql.Int,(req.user&&req.user.id)||null)
      .query(`UPDATE Organizations SET IsActive=0,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE OrgID=@id`);
    return res.json({ok:true,status:'rejected'});
  }
  res.status(400).json({error:'decision يجب أن تكون approve أو reject'});
}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════════════════════
// "حالة الجمعية من المدير" (DirFlagSuspended) - علامة منفصلة تمامًا عن
// عمود الحالة الرسمي Status. المدير العام بس اللي يقدر يحطها، ومن حالة
// "نشطة" فقط إلى "موقوفة" (ما فيش أي انتقال تاني مسموح من هنا إطلاقًا).
// عمود Status الرسمي فاضل زي ما هو - قرارات إدارة التشريعات/القيد وحدها
// اللي بتغيّره، ومش بيتأثر بالعلامة دي ولا العكس. لو التشريعات غيّرت
// الحالة الرسمية بعد كده لأي حاجة (منحلة/رجعت لممارسة النشاط/إلخ) فده
// بيتم عادي زي ما هو من غير أي تعارض - العلامة تفضل تاريخ/مرجع بس.
// ══════════════════════════════════════════════════════════════════
app.put('/api/organizations/:id/director-flag',async(req,res)=>{try{
  if(!req.user || req.user.action!=='admin') return res.status(403).json({error:'وضع علامة "موقوفة من المدير" مقصور على المدير العام فقط'});
  const id=parseInt(req.params.id)||0;
  if(!id) return res.status(400).json({error:'معرّف الجمعية غير صحيح'});
  const note=(req.body&&req.body.note)?String(req.body.note).trim().slice(0,500):null;
  const d=await db();
  const chk=await d.request().input('id',sql.Int,id).query(`SELECT Status,DirFlagSuspended FROM Organizations WHERE OrgID=@id AND IsActive=1`);
  if(!chk.recordset.length) return res.status(404).json({error:'الجمعية غير موجودة'});
  const cur=chk.recordset[0];
  if(cur.DirFlagSuspended) return res.status(409).json({error:'العلامة موضوعة بالفعل على هذه الجمعية'});
  if(cur.Status!=='نشطة') return res.status(409).json({error:'لا يمكن وضع علامة "موقوفة من المدير" إلا على جمعية حالتها الرسمية الحالية "نشطة" فقط'});
  await d.request().input('id',sql.Int,id).input('nt',sql.NVarChar,note).input('by',sql.Int,req.user.id)
    .query(`UPDATE Organizations SET DirFlagSuspended=1,DirFlagNote=@nt,DirFlagBy=@by,DirFlagAt=GETDATE() WHERE OrgID=@id`);
  await d.request().input('oid',sql.Int,id).input('nt',sql.NVarChar,note).input('by',sql.Int,req.user.id).input('st',sql.NVarChar,cur.Status)
    .query(`INSERT INTO DirectorFlagLog(OrgID,Action,Note,ByUser,StatusAtTime) VALUES(@oid,'set',@nt,@by,@st)`);
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// رجوع عن علامة "موقوفة من المدير" - المدير العام بس، ومتاح في أي وقت (بغض النظر
// عمّا فعلته إدارة التشريعات بالحالة الرسمية بعد كده) - بيمسح العلامة بس ولا يغيّر Status إطلاقًا.
app.delete('/api/organizations/:id/director-flag',async(req,res)=>{try{
  if(!req.user || req.user.action!=='admin') return res.status(403).json({error:'الرجوع عن علامة "موقوفة من المدير" مقصور على المدير العام فقط'});
  const id=parseInt(req.params.id)||0;
  if(!id) return res.status(400).json({error:'معرّف الجمعية غير صحيح'});
  const d=await db();
  const chk=await d.request().input('id',sql.Int,id).query(`SELECT Status,DirFlagSuspended FROM Organizations WHERE OrgID=@id AND IsActive=1`);
  if(!chk.recordset.length) return res.status(404).json({error:'الجمعية غير موجودة'});
  if(!chk.recordset[0].DirFlagSuspended) return res.status(409).json({error:'لا توجد علامة "موقوفة من المدير" على هذه الجمعية أصلًا'});
  await d.request().input('id',sql.Int,id)
    .query(`UPDATE Organizations SET DirFlagSuspended=0,DirFlagNote=NULL,DirFlagBy=NULL,DirFlagAt=NULL WHERE OrgID=@id`);
  await d.request().input('oid',sql.Int,id).input('by',sql.Int,req.user.id).input('st',sql.NVarChar,chk.recordset[0].Status)
    .query(`INSERT INTO DirectorFlagLog(OrgID,Action,ByUser,StatusAtTime) VALUES(@oid,'clear',@by,@st)`);
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/organizations/:id',async(req,res)=>{try{
  const d=await db();const id=parseInt(req.params.id)||0;
  const o=await d.request().input('id',sql.Int,id).query('SELECT* FROM Organizations WHERE (OrgID=@id OR RegNum=@id) AND DeletedAt IS NULL ORDER BY CASE WHEN OrgID=@id THEN 0 ELSE 1 END');
  if(!o.recordset.length)return res.status(404).json({error:'غير موجود'});
  const oid=o.recordset[0].OrgID;
  // (إصلاح) "استمارة البيانات الشاملة" كانت بتجيب بس تراخيص جمع المال/المنح/المشروعات/
  // المستندات/آخر حدث - وتبويبَي "التشريعات" و"المحظورة" كانا نص ثابت مكتوب مسبقًا
  // ("لا توجد بيانات") بغض النظر عن البيانات الحقيقية، لأن مفيش أي استعلام ليهم أصلاً هنا.
  const[lics,grants,projs,docs,evs,legs,banned,inspections,boardMembers,mergedFrom]=await Promise.all([
    d.request().input('id',sql.Int,oid).query('SELECT* FROM FundraisingLicenses WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY IssueYear DESC'),
    d.request().input('id',sql.Int,oid).query('SELECT* FROM Grants WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0'),
    d.request().input('id',sql.Int,oid).query('SELECT* FROM Projects WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0'),
    d.request().input('id',sql.Int,oid).query('SELECT* FROM Documents WHERE OrgID=@id AND (IsReplaced=0 OR IsReplaced IS NULL) ORDER BY UploadedAt DESC'),
    d.request().input('id',sql.Int,oid).query(`SELECT e.*, u.FullName AS RecordedByName
      FROM OrgEvents e LEFT JOIN Users u ON e.RecordedBy=u.UserID
      WHERE e.OrgID=@id AND ISNULL(e.IsDeleted,0)=0 ORDER BY e.EventDate DESC`),
    d.request().input('id',sql.Int,oid).query('SELECT* FROM Legislations WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY DecreeDate DESC'),
    d.request().input('id',sql.Int,oid).query('SELECT* FROM BannedOrgs WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0'),
    d.request().input('id',sql.Int,oid).query('SELECT* FROM InspectionReports WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY YearFrom DESC')
      .catch(()=>({recordset:[]})), // (جديد) لو الجدول لسه مش موجود على قاعدة بيانات قديمة، نرجّع مصفوفة فاضية بدل ما نكسر الاستعلام كله
    d.request().input('id',sql.Int,oid).query('SELECT* FROM BoardMembers WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY IsChairman DESC,MemberID')
      .catch(()=>({recordset:[]})),
    // (جديد) الجمعيات اللي اندمجت في الجمعية دي (لو وُجدت) - عشان تظهر ملحوظة "بيانات الجمعية
    // السابقة" في تبويب البيانات الثابتة، وميضيعش إن فيه بيانات إدارية منقولة من جمعية تانية أصلاً
    d.request().input('id',sql.Int,oid).query('SELECT OrgID,OrgName,RegNum,RegYear,Level,Governorate,MergedAt FROM Organizations WHERE MergedIntoOrgID=@id ORDER BY MergedAt DESC')
      .catch(()=>({recordset:[]})),
  ]);
  res.json({...o.recordset[0],licenses:lics.recordset,grants:grants.recordset,projects:projs.recordset,documents:docs.recordset,events:evs.recordset,legislations:legs.recordset,banned:banned.recordset,inspectionReports:inspections.recordset,boardMembers:boardMembers.recordset,mergedFromOrgs:mergedFrom.recordset});
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/organizations',async(req,res)=>{try{
  const d=req.body;const db2=await db();
  const dupRow=await checkRegNumDuplicate(db2,{rn:d.RegNum,lv:d.Level,gv:d.Governorate});
  if(dupRow)return res.status(409).json({error:regNumDuplicateMessage(dupRow)});
  const runInsert=()=>db2.request()
    .input('nm',sql.NVarChar,d.OrgName).input('tp',sql.NVarChar,d.OrgType)
    .input('rn',sql.Int,d.RegNum).input('ry',sql.Int,d.RegYear)
    .input('un',sql.NVarChar,d.UnifiedNumber).input('lv',sql.NVarChar,d.Level)
    .input('ad',sql.NVarChar,d.Address).input('gv',sql.NVarChar,d.Governorate)
    .input('ch',sql.NVarChar,d.Chairman).input('ph',sql.NVarChar,d.Phone)
    .input('wf',sql.NVarChar,d.WorkField).input('pb',sql.Bit,d.PublicBenefit?1:0)
    .input('st',sql.NVarChar,d.Status||'تحتاج مراجعة').input('by',sql.Int,d.CreatedBy)
    .input('rd',sql.Date,d.RegDate||null)
    .input('dd',sql.Date,(d.Status==='منحلة')?(d.DissolutionDate||new Date().toISOString().split('T')[0]):null)
    .query('INSERT INTO Organizations(OrgName,OrgType,RegNum,RegYear,UnifiedNumber,Level,Address,Governorate,Chairman,Phone,WorkField,PublicBenefit,Status,CreatedBy,RegDate,DissolutionDate) OUTPUT INSERTED.OrgID VALUES(@nm,@tp,@rn,@ry,@un,@lv,@ad,@gv,@ch,@ph,@wf,@pb,@st,@by,@rd,@dd)');
  let r;
  try{ r=await runInsert(); }
  catch(e){
    if(e.message.includes('Invalid column name')){
      await db2.request().query(`IF COL_LENGTH('Organizations','DissolutionDate') IS NULL ALTER TABLE Organizations ADD DissolutionDate DATE NULL;`);
      r=await runInsert();
    // (جديد) خط دفاع أخير ضد تسجيل نفس رقم القيد مرتين بسبب تزامن حقيقي (مثلاً ضغطتين
    // قريبتين جدًا من بعض عدّوا فحص checkRegNumDuplicate فوق قبل ما أي واحد فيهم يخلّص
    // الحفظ فعليًا) - لو الفهرس الفريد على قاعدة البيانات (UQ_RegNum_Central أو
    // UQ_RegNum_Gov_Directorate - راجعي سكريبت 24) موجود وشغال، SQL Server هيرفض ثاني
    // إدراج برقم الخطأ 2601/2627، فبنحوّلها هنا لرسالة عربي مفهومة بدل خطأ SQL خام.
    } else if(e.number===2601||e.number===2627){
      const dupRow2=await checkRegNumDuplicate(db2,{rn:d.RegNum,lv:d.Level,gv:d.Governorate});
      return res.status(409).json({error:dupRow2?regNumDuplicateMessage(dupRow2):'رقم القيد هذا مسجل مسبقاً - لا يمكن تكراره'});
    } else throw e;
  }
  res.json({ok:true,OrgID:r.recordset[0].OrgID});
}catch(e){res.status(500).json({error:e.message});}});

app.put('/api/organizations/:id',async(req,res)=>{try{
  const permChk=assertCanManageOrg(req.user);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const id=parseInt(req.params.id);
  const database=await db();
  // دمج آمن: أي خانة مش موجودة في شاشة التعديل اللي بعتت الطلب تفضل بقيمتها
  // الأصلية (زي رقم النفع العام/تاريخ القيد/الحالة) بدل ما تتمسح NULL.
  const curR=await database.request().input('id',sql.Int,id).query('SELECT * FROM Organizations WHERE OrgID=@id');
  if(!curR.recordset.length) return res.status(404).json({error:'الجمعية غير موجودة'});
  const cur=curR.recordset[0], d=req.body;
  const nm=mergeField(d,cur,'OrgName'), tp=mergeField(d,cur,'OrgType');
  const ad=mergeField(d,cur,'Address'), gv=mergeField(d,cur,'Governorate');
  const ch=mergeField(d,cur,'Chairman'), ph=mergeField(d,cur,'Phone');
  const wf=mergeField(d,cur,'WorkField'); let st=mergeField(d,cur,'Status');
  const pbRaw=mergeField(d,cur,'PublicBenefit'); const pb=(pbRaw===true||pbRaw===1||pbRaw==='1')?1:0;
  const un=mergeField(d,cur,'UnifiedNumber');
  const rd=Object.prototype.hasOwnProperty.call(d,'RegDate')?(d.RegDate||null):toDateStr(cur.RegDate);
  // ── (جديد) السماح بتصحيح "المستوى" (مركزي/مديرية) وكمان "رقم القيد" و"سنة القيد" نفسهم
  // من شاشة التعديل (البيانات الثابتة) - غالبًا لتصحيح خطأ إملائي أو طلب إضافة اتقبل ببيانات
  // غلط بالخطأ. قبل أي تغيير في أي واحد من التلاتة، بنتأكد إن التوليفة الجديدة (رقم القيد +
  // السنة + المستوى) مش مستخدمة بالفعل في جمعية تانية نشطة، عشان منسمحش بتكرار رقم قيد ──
  const lv=mergeField(d,cur,'Level');
  const rn=Object.prototype.hasOwnProperty.call(d,'RegNum')?(parseInt(d.RegNum)||cur.RegNum):cur.RegNum;
  const ry=Object.prototype.hasOwnProperty.call(d,'RegYear')?(parseInt(d.RegYear)||cur.RegYear):cur.RegYear;
  if(lv!==cur.Level || rn!==cur.RegNum || gv!==cur.Governorate){
    const dupRow=await checkRegNumDuplicate(database,{rn,lv,gv,excludeId:id});
    if(dupRow) return res.status(409).json({error:'لا يمكن الحفظ - '+regNumDuplicateMessage(dupRow)});
  }
  // (جديد) لو المستوى (مركزي/مديرية) اتغيّر فعلاً - ده معناه إدارة القيد حسمت موقف الجمعية،
  // فنسجّل ملاحظة تاريخية بكده (تظهر بعدين في عمود "حالة الجمعية")، ونشيلها من "تحتاج مراجعة"
  // تلقائياً لو كانت لسه في الانتظار (لأن القيد نفسها اتخذت إجراء حاسم بشأنها).
  let levelChangeNote=cur.LevelChangeNote||null, levelChangeDate=cur.LevelChangeDate||null;
  if(lv!==cur.Level){
    levelChangeNote = lv==='مركزي'
      ? `أصبحت مركزية من مديرية (كانت رقم ${cur.RegNum}/${cur.RegYear} - ${cur.Governorate||''})`
      : `أصبحت محلية لمديرية ${gv||''} (كانت مركزية رقم ${cur.RegNum}/${cur.RegYear})`;
    levelChangeDate=new Date().toISOString().split('T')[0];
    if(cur.Status==='تحتاج مراجعة') st='نشطة';
  } else if(Object.prototype.hasOwnProperty.call(d,'LevelChangeNote') && d.LevelChangeNote){
    // (جديد) دعم تسجيل معلومة تاريخية عن نقل سابق حتى لو المستوى الحالي متسجَّل صح بالفعل من البداية
    // (مثال: إدارة القيد بتسجل جمعية مركزية جديدة وتوضح إنها "منقولة من مديرية" كمعلومة تاريخية فقط)
    levelChangeNote = d.LevelChangeNote;
    levelChangeDate = d.LevelChangeDate || new Date().toISOString().split('T')[0];
  }
  // (جديد) تاريخ الحل - يتسجّل مرة واحدة أول ما تبقى الحالة "منحلة" (من أي إدارة حسمتها)، بدون أي شرط تكرار
  let dissolutionDate=cur.DissolutionDate||null;
  if(st==='منحلة' && !dissolutionDate){
    dissolutionDate = (d.DissolutionDate) || new Date().toISOString().split('T')[0];
  }
  const runUpdate=()=>database.request().input('id',sql.Int,id)
    .input('nm',sql.NVarChar,nm).input('tp',sql.NVarChar,tp)
    .input('ad',sql.NVarChar,ad).input('gv',sql.NVarChar,gv)
    .input('ch',sql.NVarChar,ch).input('ph',sql.NVarChar,ph)
    .input('wf',sql.NVarChar,wf).input('st',sql.NVarChar,st)
    .input('pb',sql.Bit,pb).input('un',sql.NVarChar,un)
    .input('rd',sql.Date,rd).input('lv',sql.NVarChar,lv)
    .input('rn',sql.Int,rn).input('ry',sql.Int,ry)
    .input('lcn',sql.NVarChar,levelChangeNote).input('lcd',sql.Date,levelChangeDate)
    .input('dd',sql.Date,dissolutionDate)
    .query('UPDATE Organizations SET OrgName=@nm,OrgType=@tp,Address=@ad,Governorate=@gv,Chairman=@ch,Phone=@ph,WorkField=@wf,Status=@st,PublicBenefit=@pb,UnifiedNumber=@un,RegDate=@rd,Level=@lv,RegNum=@rn,RegYear=@ry,LevelChangeNote=@lcn,LevelChangeDate=@lcd,DissolutionDate=@dd,UpdatedAt=GETDATE() WHERE OrgID=@id');
  try{
    await runUpdate();
  }catch(e){
    if(e.message.includes('Invalid column name')){
      await database.request().query(`IF COL_LENGTH('Organizations','LevelChangeNote') IS NULL ALTER TABLE Organizations ADD LevelChangeNote NVARCHAR(500) NULL;`);
      await database.request().query(`IF COL_LENGTH('Organizations','LevelChangeDate') IS NULL ALTER TABLE Organizations ADD LevelChangeDate DATE NULL;`);
      await database.request().query(`IF COL_LENGTH('Organizations','DissolutionDate') IS NULL ALTER TABLE Organizations ADD DissolutionDate DATE NULL;`);
      await runUpdate();
    } else throw e;
  }
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ── حذف جمعية بالكامل (حذف ناعم - بيانبها تفضل محفوظة للمراجعة) بسبب إجباري ──
// مقصور على المدير العام أو إدارة القيد فقط، زي ما هو متفق عليه
app.delete('/api/organizations/:id',async(req,res)=>{try{
  const permChk=assertCanManageOrg(req.user);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const id=parseInt(req.params.id);
  const conn=await db();
  const rec=await conn.request().input('id',sql.Int,id).query('SELECT OrgID FROM Organizations WHERE OrgID=@id');
  if(!rec.recordset.length) return res.status(404).json({error:'الجمعية غير موجودة'});
  await conn.request().input('id',sql.Int,id).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE Organizations SET IsActive=0,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE OrgID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════════════════════
// (جديد) دمج كل البيانات الإدارية من جمعية (المصدر) إلى جمعية تانية (الهدف) - يُستخدم لما تتصلّح
// حالة "الجمعية مسجَّلة مرتين" (مرة قديمة مديرية ومرة مركزية جديدة بنفس البيانات متفرقة).
// كل صف بينتقل بيتحط عليه ملحوظة توضيحية (MergeNote) - وأي صف فيه تعارض حقيقي مع بيانات
// موجودة بالفعل في الهدف (نفس رقم الترخيص+السنة مثلاً) بيتسيب زي ما هو ومبيتحركش، ويترجع في
// قائمة "conflicts" عشان تُراجَع يدويًا بدل ما نمسح أو نختار عشوائي.
// ══════════════════════════════════════════════════════════════════
async function performOrgMerge(tx, sourceId, targetId, preNote){
  const moved={}, conflicts=[];
  const R=()=>new sql.Request(tx);

  // جمع المال: نفس رقم الترخيص + نفس سنة الإصدار = تعارض حقيقي
  const lics=(await R().input('id',sql.Int,sourceId).query('SELECT* FROM FundraisingLicenses WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0')).recordset;
  let n=0;
  for(const row of lics){
    const dup=await R().input('tid',sql.Int,targetId).input('ln',sql.NVarChar,row.LicenseNumber).input('iy',sql.Int,row.IssueYear)
      .query('SELECT LicID FROM FundraisingLicenses WHERE OrgID=@tid AND LicenseNumber=@ln AND ISNULL(IssueYear,-1)=ISNULL(@iy,-1) AND ISNULL(IsDeleted,0)=0');
    if(dup.recordset.length){ conflicts.push({table:'جمع المال',detail:`رقم الترخيص ${row.LicenseNumber} (سنة ${row.IssueYear}) موجود بالفعل في الجمعية الهدف - لم يُنقل`}); continue; }
    await R().input('id',sql.Int,row.LicID).input('tid',sql.Int,targetId).input('nt',sql.NVarChar,preNote)
      .query('UPDATE FundraisingLicenses SET OrgID=@tid,MergeNote=@nt WHERE LicID=@id');
    n++;
  }
  moved['جمع المال']=n;

  // المشروعات: نفس الرقم التسلسلي + نفس سنة التاريخ = تعارض (لو مفيش رقم تسلسلي بننقل مباشرة)
  const projs=(await R().input('id',sql.Int,sourceId).query('SELECT* FROM Projects WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0')).recordset;
  n=0;
  for(const row of projs){
    if(row.SerialNumber){
      const dup=await R().input('tid',sql.Int,targetId).input('sn',sql.NVarChar,row.SerialNumber).input('iy',sql.Int,row.IssueYear)
        .query('SELECT ProjectID FROM Projects WHERE OrgID=@tid AND SerialNumber=@sn AND ISNULL(IssueYear,-1)=ISNULL(@iy,-1) AND ISNULL(IsDeleted,0)=0');
      if(dup.recordset.length){ conflicts.push({table:'المشروعات',detail:`الرقم التسلسلي ${row.SerialNumber} (سنة ${row.IssueYear}) موجود بالفعل في الجمعية الهدف - لم يُنقل`}); continue; }
    }
    await R().input('id',sql.Int,row.ProjectID).input('tid',sql.Int,targetId).input('nt',sql.NVarChar,preNote)
      .query('UPDATE Projects SET OrgID=@tid,MergeNote=@nt WHERE ProjectID=@id');
    n++;
  }
  moved['المشروعات']=n;

  // التشريعات: "حل الجمعية" مرة واحدة فقط مدى الجمعية - باقي الأنواع تعارض لو نفس النوع+الرقم+التاريخ
  const legs=(await R().input('id',sql.Int,sourceId).query('SELECT* FROM Legislations WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0')).recordset;
  n=0;
  for(const row of legs){
    let dupFound=false;
    if(row.DecreeType==='حل الجمعية'){
      const dup=await R().input('tid',sql.Int,targetId).query(`SELECT LegID FROM Legislations WHERE OrgID=@tid AND DecreeType=N'حل الجمعية' AND ISNULL(IsDeleted,0)=0`);
      if(dup.recordset.length){ conflicts.push({table:'التشريعات',detail:'يوجد قرار حل مسجَّل بالفعل في الجمعية الهدف - لم يُنقل قرار حل الجمعية من الجمعية المصدر'}); dupFound=true; }
    } else {
      const dup=await R().input('tid',sql.Int,targetId).input('dt',sql.NVarChar,row.DecreeType).input('dn',sql.NVarChar,row.DecreeNumber).input('dd',sql.Date,row.DecreeDate)
        .query('SELECT LegID FROM Legislations WHERE OrgID=@tid AND DecreeType=@dt AND DecreeNumber=@dn AND DecreeDate=@dd AND ISNULL(IsDeleted,0)=0');
      if(dup.recordset.length){ conflicts.push({table:'التشريعات',detail:`قرار "${row.DecreeType}" رقم ${row.DecreeNumber} موجود بالفعل في الجمعية الهدف - لم يُنقل`}); dupFound=true; }
    }
    if(dupFound) continue;
    await R().input('id',sql.Int,row.LegID).input('tid',sql.Int,targetId).input('nt',sql.NVarChar,preNote)
      .query('UPDATE Legislations SET OrgID=@tid,MergeNote=@nt WHERE LegID=@id');
    n++;
  }
  moved['التشريعات']=n;

  // تقرير تفتيش الجمعيات: نفس (من سنة - إلى سنة) = تعارض
  const irs=(await R().input('id',sql.Int,sourceId).query('SELECT* FROM InspectionReports WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0')).recordset;
  n=0;
  for(const row of irs){
    const dup=await R().input('tid',sql.Int,targetId).input('yf',sql.Int,row.YearFrom).input('yt',sql.Int,row.YearTo)
      .query('SELECT ReportID FROM InspectionReports WHERE OrgID=@tid AND YearFrom=@yf AND YearTo=@yt AND ISNULL(IsDeleted,0)=0');
    if(dup.recordset.length){ conflicts.push({table:'تقرير تفتيش الجمعيات',detail:`فترة ${row.YearFrom}-${row.YearTo} موجودة بالفعل في الجمعية الهدف - لم تُنقل`}); continue; }
    await R().input('id',sql.Int,row.ReportID).input('tid',sql.Int,targetId).input('nt',sql.NVarChar,preNote)
      .query('UPDATE InspectionReports SET OrgID=@tid,MergeNote=@nt WHERE ReportID=@id');
    n++;
  }
  moved['تقرير تفتيش الجمعيات']=n;

  // المنح والمحظورة: لا يوجد مفتاح عدم تكرار صارم - تُنقل كلها مباشرة (كل صف مستقل بطبيعته)
  const grantsMove=await R().input('sid',sql.Int,sourceId).input('tid',sql.Int,targetId).input('nt',sql.NVarChar,preNote)
    .query('UPDATE Grants SET OrgID=@tid,MergeNote=@nt WHERE OrgID=@sid AND ISNULL(IsDeleted,0)=0');
  moved['المنح']=grantsMove.rowsAffected[0]||0;
  const bannedMove=await R().input('sid',sql.Int,sourceId).input('tid',sql.Int,targetId).input('nt',sql.NVarChar,preNote)
    .query('UPDATE BannedOrgs SET OrgID=@tid,MergeNote=@nt WHERE OrgID=@sid AND ISNULL(IsDeleted,0)=0');
  moved['المحظورة']=bannedMove.rowsAffected[0]||0;

  // آخر حدث والمستندات: تُنقل كلها (لا تعارض ممكن - كل سجل حدث/مستند مستقل)
  const evMove=await R().input('sid',sql.Int,sourceId).input('tid',sql.Int,targetId).input('nt',sql.NVarChar,preNote)
    .query('UPDATE OrgEvents SET OrgID=@tid,MergeNote=@nt WHERE OrgID=@sid AND ISNULL(IsDeleted,0)=0');
  moved['آخر حدث']=evMove.rowsAffected[0]||0;
  const docMove=await R().input('sid',sql.Int,sourceId).input('tid',sql.Int,targetId).input('nt',sql.NVarChar,preNote)
    .query('UPDATE Documents SET OrgID=@tid,MergeNote=@nt WHERE OrgID=@sid');
  moved['المستندات (شامل أعضاء مجلس الإدارة)']=docMove.rowsAffected[0]||0;

  // إجابات الأسئلة الإلزامية: تُنقل بس لو الجمعية الهدف مفيهاش إجابات مسجَّلة أصلاً
  const targetHasAnswers=await R().input('tid',sql.Int,targetId).query('SELECT TOP 1 AnswerID FROM QuestionAnswers WHERE OrgID=@tid');
  if(targetHasAnswers.recordset.length){
    conflicts.push({table:'الأسئلة الإلزامية',detail:'الجمعية الهدف عندها إجابات مسجَّلة بالفعل - إجابات الجمعية المصدر لم تُنقل (تفادياً لتكرار/تعارض)'});
    moved['الأسئلة الإلزامية']=0;
  } else {
    const qaMove=await R().input('sid',sql.Int,sourceId).input('tid',sql.Int,targetId)
      .query('UPDATE QuestionAnswers SET OrgID=@tid WHERE OrgID=@sid');
    moved['الأسئلة الإلزامية']=qaMove.rowsAffected[0]||0;
  }

  return{moved,conflicts};
}

// ══ تحويل جمعية من مديرية إلى مركزي (إدارة القيد فقط - الواجهة تمنع غيرهم من الوصول لهذا الزر) ══
// بيرقّي القيد المديري لقيد مركزي جديد تلقائي وينسخ كل البيانات الثابتة الحالية بدون إعادة كتابتها،
// وينقل كل البيانات الإدارية (تراخيص/منح/مشروعات/تشريعات/محظورة/تقارير تفتيش/أحداث/مستندات) معاه
// بدل ما تفضل معلَّقة على السجل القديم غير النشط - وده أهم إصلاح هنا (كان الجدول القديم بينسخ
// البيانات الثابتة بس ويسيب كل البيانات الإدارية "يتيمة" على السجل القديم المُعطَّل).
app.post('/api/organizations/:id/transfer-to-central',async(req,res)=>{try{
  const oldId=parseInt(req.params.id)||0;
  const{RequestedBy}=req.body||{};
  const d=await db();
  const old=await d.request().input('id',sql.Int,oldId).query('SELECT* FROM Organizations WHERE OrgID=@id');
  if(!old.recordset.length)return res.status(404).json({error:'الجمعية غير موجودة'});
  const o=old.recordset[0];
  if(o.Level!=='مديرية')return res.status(400).json({error:'هذه الجمعية ليست مديرية بالفعل - لا يمكن تحويلها'});
  if(!o.IsActive)return res.status(400).json({error:'هذا السجل غير نشط بالفعل'});

  const tx=new sql.Transaction(d);
  await tx.begin();
  try{
    const next=await new sql.Request(tx).query("SELECT ISNULL(MAX(RegNum),0)+1 AS NextNum FROM Organizations WHERE Level=N'مركزي'");
    const newRegNum=next.recordset[0].NextNum;
    const newRegYear=new Date().getFullYear();

    const ins=await new sql.Request(tx)
      .input('nm',sql.NVarChar,o.OrgName).input('tp',sql.NVarChar,o.OrgType)
      .input('rn',sql.Int,newRegNum).input('ry',sql.Int,newRegYear)
      .input('un',sql.NVarChar,o.UnifiedNumber).input('lv',sql.NVarChar,'مركزي')
      .input('ad',sql.NVarChar,o.Address).input('gv',sql.NVarChar,o.Governorate)
      .input('ch',sql.NVarChar,o.Chairman).input('ph',sql.NVarChar,o.Phone)
      .input('wf',sql.NVarChar,o.WorkField).input('pb',sql.Bit,o.PublicBenefit?1:0)
      .input('st',sql.NVarChar,o.Status||'نشطة').input('by',sql.Int,RequestedBy||o.CreatedBy||null)
      .input('rd',sql.Date,o.RegDate)
      .input('prn',sql.Int,o.RegNum).input('pry',sql.Int,o.RegYear).input('pgv',sql.NVarChar,o.Governorate)
      .input('nt',sql.NVarChar,`منقولة من المديرية (${o.Governorate||''}) - رقم القيد السابق: ${o.RegNum}/${o.RegYear}`)
      .query(`INSERT INTO Organizations(OrgName,OrgType,RegNum,RegYear,UnifiedNumber,Level,Address,Governorate,Chairman,Phone,WorkField,PublicBenefit,Status,CreatedBy,RegDate,PrevRegNum,PrevRegYear,PrevGovTransfer,Notes)
        OUTPUT INSERTED.OrgID
        VALUES(@nm,@tp,@rn,@ry,@un,@lv,@ad,@gv,@ch,@ph,@wf,@pb,@st,@by,@rd,@prn,@pry,@pgv,@nt)`);
    const newOrgId=ins.recordset[0].OrgID;

    const preNote=`هذه البيانات قبل أن تكون الجمعية مركزية (كانت مديرية - رقم القيد ${o.RegNum}/${o.RegYear} - ${o.Governorate||''})`;
    const{moved,conflicts}=await performOrgMerge(tx,oldId,newOrgId,preNote);

    await new sql.Request(tx).input('id',sql.Int,oldId).input('mid',sql.Int,newOrgId)
      .input('mnt',sql.NVarChar,`اندمجت في الجمعية المركزية "${o.OrgName}" (رقم ${newRegNum}/${newRegYear})`)
      .input('nrn',sql.Int,newRegNum).input('nry',sql.Int,newRegYear)
      .query(`UPDATE Organizations SET IsActive=0,Level=N'منقولة من المديرية',NewRegNum=@nrn,NewRegYear=@nry,NewGovTransfer=N'مركزي',TransferDate=GETDATE(),MergedIntoOrgID=@mid,MergedNote=@mnt,MergedAt=GETDATE(),UpdatedAt=GETDATE() WHERE OrgID=@id`);

    await tx.commit();
    res.json({ok:true,OrgID:newOrgId,RegNum:newRegNum,RegYear:newRegYear,moved,conflicts});
  }catch(e){
    await tx.rollback();
    throw e;
  }
}catch(e){res.status(500).json({error:e.message});}});

// (جديد) دمج جمعية (بيانات إدارية متكررة) في جمعية أخرى موجودة بالفعل - يُستخدم من فورم "أصبحت
// مركزية" في القيد لما يختار المستخدم إن الجمعية المركزية موجودة أصلاً بدل ما يسجّل رقم قيد جديد.
app.post('/api/organizations/:sourceId/merge-into/:targetId',async(req,res)=>{try{
  const permChk=assertCanManageOrg(req.user);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const sourceId=parseInt(req.params.sourceId)||0;
  const targetId=parseInt(req.params.targetId)||0;
  if(sourceId===targetId) return res.status(400).json({error:'لا يمكن دمج الجمعية في نفسها'});
  const d=await db();
  const srcR=await d.request().input('id',sql.Int,sourceId).query('SELECT* FROM Organizations WHERE OrgID=@id');
  const tgtR=await d.request().input('id',sql.Int,targetId).query('SELECT* FROM Organizations WHERE OrgID=@id');
  if(!srcR.recordset.length||!tgtR.recordset.length) return res.status(404).json({error:'إحدى الجمعيتين غير موجودة'});
  const src=srcR.recordset[0], tgt=tgtR.recordset[0];

  // (جديد) enforceSingleMerge=true: يمنع دمج أكتر من جمعية "مصدر" في نفس الجمعية "الهدف" مرة
  // تانية - يُستخدم مع "منقولة من مديرية" عشان محدش يدمج جمعيتين مديرية مختلفتين في نفس
  // الجمعية المركزية بالغلط (تسبب تكرار). صفحة "نقل البيانات" العامة ما بتبعتش الاختيار ده،
  // فمسموح تُستخدم أكتر من مرة (تصحيح بيانات عادي مش مرتبط بمركزي/مديرية).
  if(req.body?.enforceSingleMerge){
    const already=await d.request().input('tid',sql.Int,targetId)
      .query('SELECT OrgID,OrgName FROM Organizations WHERE MergedIntoOrgID=@tid');
    if(already.recordset.length){
      return res.status(409).json({error:`هذه الجمعية سبق ودُمجت معها جمعية أخرى ("${already.recordset[0].OrgName}") من قبل - لا يمكن الدمج مرة أخرى تفادياً لتكرار البيانات`});
    }
  }

  const tx=new sql.Transaction(d);
  await tx.begin();
  try{
    const preNote=req.body?.note || `منقولة من جمعية أخرى (كانت: ${src.OrgName} - رقم ${src.RegNum}/${src.RegYear} - ${src.Level})`;
    const{moved,conflicts}=await performOrgMerge(tx,sourceId,targetId,preNote);

    await new sql.Request(tx).input('id',sql.Int,sourceId).input('mid',sql.Int,targetId)
      .input('mnt',sql.NVarChar,`اندمجت في الجمعية "${tgt.OrgName}" (رقم ${tgt.RegNum}/${tgt.RegYear} - ${tgt.Level})`)
      .query(`UPDATE Organizations SET IsActive=0,MergedIntoOrgID=@mid,MergedNote=@mnt,MergedAt=GETDATE(),UpdatedAt=GETDATE() WHERE OrgID=@id`);

    await tx.commit();
    res.json({ok:true,TargetOrgID:targetId,moved,conflicts});
  }catch(e){
    await tx.rollback();
    throw e;
  }
}catch(e){res.status(500).json({error:e.message});}});



app.get('/api/next-central-regnum',async(req,res)=>{try{
  const r=await(await db()).request().query("SELECT ISNULL(MAX(RegNum),0)+1 AS NextNum FROM Organizations WHERE Level=N'مركزي'");
  res.json({nextNum:r.recordset[0].NextNum});
}catch(e){res.status(500).json({error:e.message});}});

// LICENSES
// ── جلب كل تراخيص جمع المال دفعة واحدة (لتغذية LICENSE_REGISTRY في الواجهة) ──
// ملحوظة: قبل إضافة هذا الـendpoint، كانت شاشات إحصاء جمع المال (والمحافظات المعتمِدة عليه)
// بتعتمد على LICENSE_REGISTRY فاضي دايمًا في الواجهة، فمفيش أي تقرير كان بيظهر بيانات حقيقية
// مهما كانت البيانات صحيحة في قاعدة البيانات - المشكلة مكنتش في الفلترة، كانت في عدم التحميل أصلاً.
app.get('/api/licenses',async(req,res)=>{try{
  const r=await(await db()).request().query(`SELECT f.*, o.OrgName, o.RegNum, o.RegYear AS OrgRegYear, o.Governorate, o.Address AS OrgAddress
    FROM FundraisingLicenses f JOIN Organizations o ON f.OrgID=o.OrgID
    WHERE ISNULL(f.IsDeleted,0)=0
    ORDER BY f.IssueYear DESC, f.IssueMonth DESC`);
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/licenses/:orgId',async(req,res)=>{try{
  const id=parseInt(req.params.orgId)||0;
  const r=await(await db()).request().input('id',sql.Int,id)
    .query('SELECT* FROM FundraisingLicenses WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY IssueYear DESC,IssueMonth DESC');
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/licenses',async(req,res)=>{try{
  const d=req.body;const db2=await db();
  // ── مصدر الحقيقة لشهر/سنة الإصدار والتصفية هو نص التاريخ نفسه (YYYY-MM-DD) وليس خانات
  // "شهر الإصدار"/"سنة الإصدار" المنفصلة في الواجهة: خانة الشهر <select> بترجع قيمة افتراضية
  // (1 = يناير) لو المستخدم دخل التاريخ الفعلي بس ومساش الخانة دي، فلو اعتمدنا عليها تسجل
  // شهر غلط ويضيع السجل من التقارير الشهرية/ربع السنوية. لذلك نحسب من التاريخ أولاً، ونرجع
  // للقيم المرسلة من الواجهة فقط لو مفيش تاريخ خالص (حالات بيانات قديمة بشهر/سنة بس بدون تاريخ محدد).
  // (ymParts دالة عامة معرّفة أعلى الملف - تُستخدم هنا وفي كل نقاط حفظ/تعديل تراخيص جمع المال)
  const issueP=ymParts(d.IssueDate), liqP=ymParts(d.LiquidationDate);
  const issueMonth=(issueP?issueP.m:null)||d.IssueMonth||null;
  const issueYear=(issueP?issueP.y:null)||d.IssueYear||null;
  const liqMonth=(liqP?liqP.m:null)||d.LiquidationMonth||null;
  const liqYear=(liqP?liqP.y:null)||d.LiquidationYear||null;
  // التكرار الممنوع فعلياً هو: نفس الجمعية + نفس رقم الترخيص + نفس سنة الإصدار معاً.
  // نفس رقم الترخيص لنفس الجمعية في سنة إصدار مختلفة أمر طبيعي ومسموح.
  const dup=await db2.request().input('oid',sql.Int,d.OrgID).input('ln',sql.NVarChar,d.LicenseNumber)
    .input('iy',sql.Int,issueYear)
    .query('SELECT LicID FROM FundraisingLicenses WHERE OrgID=@oid AND LicenseNumber=@ln AND ISNULL(IssueYear,-1)=ISNULL(@iy,-1)');
  if(dup.recordset.length)return res.status(409).json({error:'تم تسجيل هذا الترخيص من قبل لنفس الجمعية ونفس سنة الإصدار'});
  await db2.request()
    .input('oid',sql.Int,d.OrgID).input('ln',sql.NVarChar,d.LicenseNumber)
    .input('ls',sql.NVarChar,d.LicenseStatus||'ساري')
    .input('id2',sql.Date,d.IssueDate||null).input('im',sql.Int,issueMonth).input('iy',sql.Int,issueYear)
    .input('sd',sql.Date,d.StartDate||null).input('ed',sql.Date,d.EndDate||null)
    .input('ld',sql.Date,d.LiquidationDate||null).input('lm',sql.Int,liqMonth).input('ly',sql.Int,liqYear)
    .input('rv',sql.Decimal,d.Revenue||0).input('ex',sql.Decimal,d.Expenses||0)
    // (إصلاح) النت (NetAmount) عمود بيُكتب يدويًا (ترقية 18) - لو مفيش قيمة مُرسلة من الواجهة
    // لازم نسيبها NULL عشان الواجهة تحسبها تلقائي = إيرادات - مصروفات. كانت بتتسجّل 0 دايمًا
    // (بدل NULL) فكل ترخيص جديد بيتسجل بصافي = صفر فعليًا في القاعدة حتى لو حصيلته حقيقية.
    .input('na',sql.Decimal(18,2),(d.NetAmount!==undefined&&d.NetAmount!==null&&d.NetAmount!=='')?d.NetAmount:null)
    .input('lq',sql.NVarChar,d.LiquidationStatus||null).input('dt',sql.NVarChar,d.DataType||'جديدة')
    .input('cm',sql.NVarChar,toCsv(d.CollectionMethods)).input('lp',sql.NVarChar,toCsv(d.LicensePurpose))
    .input('by2',sql.Int,d.CreatedBy||null).input('dp',sql.NVarChar,d.Department||null)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .query('INSERT INTO FundraisingLicenses(OrgID,LicenseNumber,LicenseStatus,IssueDate,IssueMonth,IssueYear,StartDate,EndDate,LiquidationDate,LiquidationMonth,LiquidationYear,Revenue,Expenses,NetAmount,LiquidationStatus,DataType,CollectionMethods,LicensePurpose,CreatedBy,Department,FilePath) VALUES(@oid,@ln,@ls,@id2,@im,@iy,@sd,@ed,@ld,@lm,@ly,@rv,@ex,@na,@lq,@dt,@cm,@lp,@by2,@dp,@fp)');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════
// ══ GRANTS / PROJECTS / LEGISLATIONS / BANNED ORGS ══
// (قبل هذا التعديل، بيانات هذه الإدارات الأربعة كانت تُحفظ فقط كـ"حدث" نصّي عام
//  في OrgEvents ولا تصل إطلاقاً لجداولها الحقيقية، فكانت كل شاشات الإحصاء ترجع صفر
//  دائماً. الآن نضيف Endpoints حقيقية تكتب في الجداول الفعلية Grants/Projects/
//  Legislations/BannedOrgs، ونُبقي أيضاً على تسجيل حدث ملخّص في OrgEvents حتى
//  تستمر شاشة "آخر حدث" و"البحث الإداري" في العمل كما هي. ══
// ══════════════════════════════════════════════════

// ── GRANTS ──
app.get('/api/grants/:orgId',async(req,res)=>{try{
  const id=parseInt(req.params.orgId)||0;
  const r=await(await db()).request().input('id',sql.Int,id)
    .query('SELECT* FROM Grants WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY GrantYear DESC,GrantID DESC');
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/grants',async(req,res)=>{try{
  const d=req.body;
  // نفس قاعدة "الرقم التسلسلي + السنة" المستخدمة في تراخيص جمع المال بالظبط: نفس الجمعية
  // + نفس رقم المنحة + نفس سنة المنحة = تكرار مرفوض. لو مفيش رقم منحة مكتوب أصلاً، مفيش
  // رقم تسلسلي نقارن بيه فنسمح بالحفظ عادي (كمان لو فيه أكتر من منحة بنفس الاسم بس رقم مختلف).
  if(d.GrantNumber){
    const dup=await(await db()).request().input('oid',sql.Int,d.OrgID).input('gnum',sql.NVarChar,d.GrantNumber)
      .input('gy',sql.Int,d.GrantYear||null)
      .query('SELECT GrantID FROM Grants WHERE OrgID=@oid AND GrantNumber=@gnum AND ISNULL(IsDeleted,0)=0 AND ISNULL(GrantYear,-1)=ISNULL(@gy,-1)');
    if(dup.recordset.length)return res.status(409).json({error:'تم تسجيل هذه المنحة من قبل لنفس الجمعية ونفس السنة'});
  }
  const r=await(await db()).request()
    .input('oid',sql.Int,d.OrgID).input('gnum',sql.NVarChar,d.GrantNumber||null).input('gn',sql.NVarChar,d.GrantName)
    .input('gt',sql.NVarChar,d.GrantType||null).input('am',sql.Decimal(18,2),d.Amount||0)
    .input('gy',sql.Int,d.GrantYear||null).input('nt',sql.NVarChar,d.Notes||null)
    .input('dp',sql.NVarChar,d.Department||null).input('by',sql.Int,d.CreatedBy||null)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .query('INSERT INTO Grants(OrgID,GrantNumber,GrantName,GrantType,Amount,GrantYear,Notes,Department,CreatedBy,FilePath) OUTPUT INSERTED.GrantID VALUES(@oid,@gnum,@gn,@gt,@am,@gy,@nt,@dp,@by,@fp)');
  res.json({ok:true,GrantID:r.recordset[0].GrantID});
}catch(e){
  // لو عمود "رقم المنحة" لسه مش موجود بقاعدة بيانات قديمة، نضيفه تلقائيًا ثم نعيد المحاولة
  if(e.message.includes('Invalid column name')){
    try{
      await(await db()).request().query(`IF COL_LENGTH('Grants','GrantNumber') IS NULL ALTER TABLE Grants ADD GrantNumber NVARCHAR(100) NULL;`);
      await(await db()).request().query(`IF COL_LENGTH('Grants','FilePath') IS NULL ALTER TABLE Grants ADD FilePath NVARCHAR(1000) NULL;`);
      const d=req.body;
      const r2=await(await db()).request()
        .input('oid',sql.Int,d.OrgID).input('gnum',sql.NVarChar,d.GrantNumber||null).input('gn',sql.NVarChar,d.GrantName)
        .input('gt',sql.NVarChar,d.GrantType||null).input('am',sql.Decimal(18,2),d.Amount||0)
        .input('gy',sql.Int,d.GrantYear||null).input('nt',sql.NVarChar,d.Notes||null)
        .input('fp',sql.NVarChar,d.FilePath||null)
        .query('INSERT INTO Grants(OrgID,GrantNumber,GrantName,GrantType,Amount,GrantYear,Notes,FilePath) OUTPUT INSERTED.GrantID VALUES(@oid,@gnum,@gn,@gt,@am,@gy,@nt,@fp)');
      res.json({ok:true,GrantID:r2.recordset[0].GrantID});
    }catch(e2){res.status(500).json({error:e2.message});}
  } else res.status(500).json({error:e.message});
}});

app.put('/api/grants/:id',async(req,res)=>{try{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'Grants','GrantID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const database=await db();
  // نفس الإصلاح الجذري المطبَّق على كل الإدارات: أي خانة ميبعتهاش نموذج التعديل تفضل
  // بقيمتها الأصلية بدل ما تتمسح NULL وتكسر إحصاء المنح حسب السنة.
  const curR=await database.request().input('id',sql.Int,id).query('SELECT* FROM Grants WHERE GrantID=@id');
  if(!curR.recordset.length) return res.status(404).json({error:'المنحة غير موجودة'});
  const cur=curR.recordset[0], d=req.body;
  const gnum=mergeField(d,cur,'GrantNumber'), gn=mergeField(d,cur,'GrantName');
  const gt=mergeField(d,cur,'GrantType');
  const am=Object.prototype.hasOwnProperty.call(d,'Amount')?(d.Amount||0):cur.Amount;
  const gy=mergeField(d,cur,'GrantYear'), nt=mergeField(d,cur,'Notes');
  await database.request().input('id',sql.Int,id)
    .input('gnum',sql.NVarChar,gnum).input('gn',sql.NVarChar,gn).input('gt',sql.NVarChar,gt)
    .input('am',sql.Decimal(18,2),am).input('gy',sql.Int,gy).input('nt',sql.NVarChar,nt)
    .query('UPDATE Grants SET GrantNumber=@gnum,GrantName=@gn,GrantType=@gt,Amount=@am,GrantYear=@gy,Notes=@nt WHERE GrantID=@id');
  res.json({ok:true});
}catch(e){
  if(e.message.includes('Invalid column name')){
    try{
      await(await db()).request().query(`IF COL_LENGTH('Grants','GrantNumber') IS NULL ALTER TABLE Grants ADD GrantNumber NVARCHAR(100) NULL;`);
      const d=req.body;
      await(await db()).request().input('id',sql.Int,parseInt(req.params.id))
        .input('gnum',sql.NVarChar,d.GrantNumber||null).input('gn',sql.NVarChar,d.GrantName).input('gt',sql.NVarChar,d.GrantType||null)
        .input('am',sql.Decimal(18,2),d.Amount||0).input('gy',sql.Int,d.GrantYear||null).input('nt',sql.NVarChar,d.Notes||null)
        .query('UPDATE Grants SET GrantNumber=@gnum,GrantName=@gn,GrantType=@gt,Amount=@am,GrantYear=@gy,Notes=@nt WHERE GrantID=@id');
      res.json({ok:true});
    }catch(e2){res.status(500).json({error:e2.message});}
  } else res.status(500).json({error:e.message});
}});

app.delete('/api/grants/:id',async(req,res)=>{try{
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const permChk=await assertCanManageDeptRecord(req.user,'Grants','GrantID',parseInt(req.params.id));
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  await(await db()).request().input('id',sql.Int,parseInt(req.params.id)).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE Grants SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE GrantID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ── PROJECTS ──
app.get('/api/projects/:orgId',async(req,res)=>{try{
  const id=parseInt(req.params.orgId)||0;
  const r=await(await db()).request().input('id',sql.Int,id)
    .query('SELECT* FROM Projects WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY ProjectID DESC');
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/projects',async(req,res)=>{try{
  const d=req.body;
  // رقم تسلسلي (يُكتب يدويًا) + تاريخ - بنفس فكرة رقم الترخيص في جمع المال بالظبط:
  // التكرار الممنوع = نفس الجمعية + نفس الرقم التسلسلي + نفس سنة التاريخ معًا.
  const issP=ymParts(d.IssueDate);
  const issueYear=(issP?issP.y:null)||d.IssueYear||null;
  if(d.SerialNumber){
    const dup=await(await db()).request().input('oid',sql.Int,d.OrgID).input('sn',sql.NVarChar,d.SerialNumber)
      .input('iy',sql.Int,issueYear)
      .query('SELECT ProjectID FROM Projects WHERE OrgID=@oid AND SerialNumber=@sn AND ISNULL(IssueYear,-1)=ISNULL(@iy,-1) AND ISNULL(IsDeleted,0)=0');
    if(dup.recordset.length)return res.status(409).json({error:'تم تسجيل هذا الرقم التسلسلي من قبل لنفس الجمعية ونفس السنة'});
  }
  const r=await(await db()).request()
    .input('oid',sql.Int,d.OrgID).input('pt',sql.NVarChar,d.ProjectType||null)
    .input('ia',sql.Bit,d.IsAssigned?1:0).input('ct',sql.Int,d.Count||1).input('nt',sql.NVarChar,d.Notes||null)
    .input('sn',sql.NVarChar,d.SerialNumber||null).input('id2',sql.Date,d.IssueDate||null).input('iy',sql.Int,issueYear)
    .input('dp',sql.NVarChar,d.Department||null).input('by',sql.Int,d.CreatedBy||null)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .query('INSERT INTO Projects(OrgID,ProjectType,IsAssigned,Count,Notes,SerialNumber,IssueDate,IssueYear,Department,CreatedBy,FilePath) OUTPUT INSERTED.ProjectID VALUES(@oid,@pt,@ia,@ct,@nt,@sn,@id2,@iy,@dp,@by,@fp)');
  res.json({ok:true,ProjectID:r.recordset[0].ProjectID});
}catch(e){res.status(500).json({error:e.message});}});

app.put('/api/projects/:id',async(req,res)=>{try{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'Projects','ProjectID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const database=await db();
  const curR=await database.request().input('id',sql.Int,id).query('SELECT* FROM Projects WHERE ProjectID=@id');
  if(!curR.recordset.length) return res.status(404).json({error:'المشروع غير موجود'});
  const cur=curR.recordset[0], d=req.body;
  const pt=mergeField(d,cur,'ProjectType');
  const iaRaw=mergeField(d,cur,'IsAssigned'); const ia=(iaRaw===true||iaRaw===1||iaRaw==='1')?1:0;
  const ct=Object.prototype.hasOwnProperty.call(d,'Count')?(d.Count||1):cur.Count;
  const nt=mergeField(d,cur,'Notes');
  const sn=mergeField(d,cur,'SerialNumber');
  const idate=Object.prototype.hasOwnProperty.call(d,'IssueDate')?(d.IssueDate||null):toDateStr(cur.IssueDate);
  const issP=ymParts(idate);
  const iy=(issP?issP.y:null)||cur.IssueYear||null;
  if(sn){
    const dup=await database.request().input('oid',sql.Int,cur.OrgID).input('sn',sql.NVarChar,sn)
      .input('iy',sql.Int,iy).input('id',sql.Int,id)
      .query('SELECT ProjectID FROM Projects WHERE OrgID=@oid AND SerialNumber=@sn AND ISNULL(IssueYear,-1)=ISNULL(@iy,-1) AND ISNULL(IsDeleted,0)=0 AND ProjectID<>@id');
    if(dup.recordset.length)return res.status(409).json({error:'تم تسجيل هذا الرقم التسلسلي من قبل لنفس الجمعية ونفس السنة'});
  }
  await database.request().input('id',sql.Int,id)
    .input('pt',sql.NVarChar,pt).input('ia',sql.Bit,ia)
    .input('ct',sql.Int,ct).input('nt',sql.NVarChar,nt)
    .input('sn',sql.NVarChar,sn).input('id2',sql.Date,idate).input('iy',sql.Int,iy)
    .query('UPDATE Projects SET ProjectType=@pt,IsAssigned=@ia,Count=@ct,Notes=@nt,SerialNumber=@sn,IssueDate=@id2,IssueYear=@iy WHERE ProjectID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.delete('/api/projects/:id',async(req,res)=>{try{
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const permChk=await assertCanManageDeptRecord(req.user,'Projects','ProjectID',parseInt(req.params.id));
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  await(await db()).request().input('id',sql.Int,parseInt(req.params.id)).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE Projects SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE ProjectID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ── LEGISLATIONS ──
app.get('/api/legislations/:orgId',async(req,res)=>{try{
  const id=parseInt(req.params.orgId)||0;
  const r=await(await db()).request().input('id',sql.Int,id)
    .query('SELECT* FROM Legislations WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY DecreeDate DESC,LegID DESC');
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

// ── تقرير تفتيش الجمعيات (مركزي - شئون جمعيات / مديريات) ──
// النطاق (مركزي/مديرية) يتحدد تلقائيًا من مستوى الجمعية وقت الحفظ - مفيش اختيار يدوي منفصل.
// عدم التكرار: نفس الجمعية + نفس (السنة من + السنة إلى) لا يتكرر.
const ENSURE_INSPECTION_TABLE_SQL=`IF OBJECT_ID('InspectionReports','U') IS NULL
BEGIN
  CREATE TABLE InspectionReports (
    ReportID INT IDENTITY(1,1) PRIMARY KEY,
    OrgID INT NOT NULL REFERENCES Organizations(OrgID),
    Scope NVARCHAR(20) NOT NULL,
    YearFrom INT NOT NULL, YearTo INT NOT NULL,
    AuditorName NVARCHAR(200),
    OpeningBalance DECIMAL(18,2), Revenue DECIMAL(18,2), Expenses DECIMAL(18,2), ClosingBalance DECIMAL(18,2),
    CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(), IsDeleted BIT DEFAULT 0
  );
END`;
async function ensureInspectionTable(database){ await database.request().query(ENSURE_INSPECTION_TABLE_SQL); }

app.get('/api/inspection-reports/:orgId',async(req,res)=>{try{
  const id=parseInt(req.params.orgId)||0;
  const database=await db();
  const run=()=>database.request().input('id',sql.Int,id)
    .query('SELECT* FROM InspectionReports WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY YearFrom DESC,ReportID DESC');
  try{ res.json((await run()).recordset); }
  catch(e){
    if(e.message.includes('Invalid object name')){ await ensureInspectionTable(database); res.json((await run()).recordset); }
    else throw e;
  }
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/inspection-reports',async(req,res)=>{try{
  const d=req.body;
  if(!d.OrgID) return res.status(400).json({error:'الجمعية مطلوبة'});
  const yf=parseInt(d.YearFrom), yt=parseInt(d.YearTo);
  if(!yf||!yt) return res.status(400).json({error:'السنة من والسنة إلى مطلوبتان'});
  if(yt<yf) return res.status(400).json({error:'"السنة إلى" لازم تكون بعد أو تساوي "السنة من"'});
  const database=await db();
  const orgR=await database.request().input('oid',sql.Int,d.OrgID).query('SELECT Level FROM Organizations WHERE OrgID=@oid');
  if(!orgR.recordset.length) return res.status(404).json({error:'الجمعية غير موجودة'});
  const scope=orgR.recordset[0].Level==='مركزي'?'مركزي':'مديرية';
  const runInsert=()=>database.request()
    .input('oid',sql.Int,d.OrgID).input('sc',sql.NVarChar,scope)
    .input('yf',sql.Int,yf).input('yt',sql.Int,yt)
    .input('an',sql.NVarChar,d.AuditorName||null)
    .input('ob',sql.Decimal(18,2),d.OpeningBalance||0).input('rv',sql.Decimal(18,2),d.Revenue||0)
    .input('ex',sql.Decimal(18,2),d.Expenses||0).input('cb',sql.Decimal(18,2),d.ClosingBalance||0)
    .input('by',sql.Int,d.CreatedBy||null).input('dp',sql.NVarChar,d.Department||'تقرير تفتيش الجمعيات')
    .input('fp',sql.NVarChar,d.FilePath||null)
    .query('INSERT INTO InspectionReports(OrgID,Scope,YearFrom,YearTo,AuditorName,OpeningBalance,Revenue,Expenses,ClosingBalance,CreatedBy,Department,FilePath) OUTPUT INSERTED.ReportID VALUES(@oid,@sc,@yf,@yt,@an,@ob,@rv,@ex,@cb,@by,@dp,@fp)');
  const checkDup=()=>database.request().input('oid',sql.Int,d.OrgID).input('yf',sql.Int,yf).input('yt',sql.Int,yt)
    .query('SELECT ReportID FROM InspectionReports WHERE OrgID=@oid AND YearFrom=@yf AND YearTo=@yt AND ISNULL(IsDeleted,0)=0');
  try{
    const dup=await checkDup();
    if(dup.recordset.length) return res.status(409).json({error:`يوجد تقرير تفتيش مسجَّل بالفعل لهذه الجمعية لنفس الفترة (${yf} - ${yt})`});
    const r=await runInsert();
    res.json({ok:true,ReportID:r.recordset[0].ReportID});
  }catch(e){
    if(e.message.includes('Invalid object name')){
      await ensureInspectionTable(database);
      const r=await runInsert();
      res.json({ok:true,ReportID:r.recordset[0].ReportID});
    } else throw e;
  }
}catch(e){res.status(500).json({error:e.message});}});

app.put('/api/inspection-reports/:id',async(req,res)=>{try{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'InspectionReports','ReportID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const database=await db();
  const curR=await database.request().input('id',sql.Int,id).query('SELECT* FROM InspectionReports WHERE ReportID=@id');
  if(!curR.recordset.length) return res.status(404).json({error:'التقرير غير موجود'});
  const cur=curR.recordset[0], d=req.body;
  const yf=Object.prototype.hasOwnProperty.call(d,'YearFrom')?(parseInt(d.YearFrom)||cur.YearFrom):cur.YearFrom;
  const yt=Object.prototype.hasOwnProperty.call(d,'YearTo')?(parseInt(d.YearTo)||cur.YearTo):cur.YearTo;
  if(yt<yf) return res.status(400).json({error:'"السنة إلى" لازم تكون بعد أو تساوي "السنة من"'});
  const an=mergeField(d,cur,'AuditorName');
  const ob=Object.prototype.hasOwnProperty.call(d,'OpeningBalance')?d.OpeningBalance:cur.OpeningBalance;
  const rv=Object.prototype.hasOwnProperty.call(d,'Revenue')?d.Revenue:cur.Revenue;
  const ex=Object.prototype.hasOwnProperty.call(d,'Expenses')?d.Expenses:cur.Expenses;
  const cb=Object.prototype.hasOwnProperty.call(d,'ClosingBalance')?d.ClosingBalance:cur.ClosingBalance;
  if(yf!==cur.YearFrom || yt!==cur.YearTo){
    const dup=await database.request().input('oid',sql.Int,cur.OrgID).input('yf',sql.Int,yf).input('yt',sql.Int,yt).input('id',sql.Int,id)
      .query('SELECT ReportID FROM InspectionReports WHERE OrgID=@oid AND YearFrom=@yf AND YearTo=@yt AND ISNULL(IsDeleted,0)=0 AND ReportID<>@id');
    if(dup.recordset.length) return res.status(409).json({error:`يوجد تقرير تفتيش مسجَّل بالفعل لهذه الجمعية لنفس الفترة (${yf} - ${yt})`});
  }
  await database.request().input('id',sql.Int,id)
    .input('yf',sql.Int,yf).input('yt',sql.Int,yt).input('an',sql.NVarChar,an)
    .input('ob',sql.Decimal(18,2),ob).input('rv',sql.Decimal(18,2),rv)
    .input('ex',sql.Decimal(18,2),ex).input('cb',sql.Decimal(18,2),cb)
    .query('UPDATE InspectionReports SET YearFrom=@yf,YearTo=@yt,AuditorName=@an,OpeningBalance=@ob,Revenue=@rv,Expenses=@ex,ClosingBalance=@cb WHERE ReportID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.delete('/api/inspection-reports/:id',async(req,res)=>{try{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'InspectionReports','ReportID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const{reason}=req.body;
  await(await db()).request().input('id',sql.Int,id).input('rs',sql.NVarChar,reason||null).input('by',sql.Int,req.user?.id||null)
    .query('UPDATE InspectionReports SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE ReportID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/legislations',async(req,res)=>{try{
  const d=req.body;
  if(!d.OrgID) return res.status(400).json({error:'الجمعية مطلوبة'});
  if(!d.DecreeType) return res.status(400).json({error:'نوع القرار مطلوب'});
  // كل نوع قرار له رقم وتاريخ خاص به الآن.
  const decNum=d.DecreeNumber||null;
  const decDate=d.DecreeDate||null;
  const isDissolution=d.DecreeType==='حل الجمعية';
  const conn=await db();
  if(isDissolution){
    // قاعدة خاصة: "حل الجمعية" لا يتكرر أبداً لنفس الجمعية (مرة واحدة مدى حياة الجمعية، بغض النظر عن الرقم/التاريخ)
    const dup=await conn.request().input('oid',sql.Int,d.OrgID)
      .query(`SELECT LegID FROM Legislations WHERE OrgID=@oid AND DecreeType=N'حل الجمعية' AND ISNULL(IsDeleted,0)=0`);
    if(dup.recordset.length) return res.status(409).json({error:'هذه الجمعية اتحلّت بالفعل من قبل - لا يجوز تسجيل قرار حل جمعية مرة أخرى، ولا أي بيانات إدارية أخرى بعد الحل'});
  } else {
    // باقي الأنواع (إيقاف/تشكيل لجان/مجلس مؤقت/مخصص): يمكن تكرار نفس النوع، لكن ليس بنفس الرقم+التاريخ معاً
    if(!decNum || !decDate) return res.status(400).json({error:'رقم القرار وتاريخه مطلوبان'});
    const dup=await conn.request().input('oid',sql.Int,d.OrgID).input('dt',sql.NVarChar,d.DecreeType)
      .input('dn',sql.NVarChar,decNum).input('dd',sql.Date,decDate)
      .query('SELECT LegID FROM Legislations WHERE OrgID=@oid AND DecreeType=@dt AND DecreeNumber=@dn AND DecreeDate=@dd AND ISNULL(IsDeleted,0)=0');
    if(dup.recordset.length) return res.status(409).json({error:`تم تسجيل قرار "${d.DecreeType}" بنفس الرقم والتاريخ من قبل لهذه الجمعية`});
    // منع تسجيل أي قرار جديد بعد الحل نهائياً
    const dissolved=await conn.request().input('oid',sql.Int,d.OrgID)
      .query(`SELECT LegID FROM Legislations WHERE OrgID=@oid AND DecreeType=N'حل الجمعية' AND ISNULL(IsDeleted,0)=0`);
    if(dissolved.recordset.length) return res.status(409).json({error:'هذه الجمعية اتحلّت بالفعل - لا يجوز تسجيل أي قرار تشريعي جديد لها'});
  }
  const r=await conn.request()
    .input('oid',sql.Int,d.OrgID).input('dt',sql.NVarChar,d.DecreeType)
    .input('dn',sql.NVarChar,decNum).input('dd',sql.Date,decDate)
    .input('nt',sql.NVarChar,d.Notes||null)
    .input('dp',sql.NVarChar,d.Department||null).input('by',sql.Int,d.CreatedBy||null)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .query('INSERT INTO Legislations(OrgID,DecreeType,DecreeNumber,DecreeDate,Notes,Department,CreatedBy,FilePath) OUTPUT INSERTED.LegID VALUES(@oid,@dt,@dn,@dd,@nt,@dp,@by,@fp)');
  res.json({ok:true,LegID:r.recordset[0].LegID});
}catch(e){res.status(500).json({error:e.message});}});

app.put('/api/legislations/:id',async(req,res)=>{try{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'Legislations','LegID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const database=await db();
  const curR=await database.request().input('id',sql.Int,id).query('SELECT* FROM Legislations WHERE LegID=@id');
  if(!curR.recordset.length) return res.status(404).json({error:'التشريع غير موجود'});
  const cur=curR.recordset[0], d=req.body;
  const dt=mergeField(d,cur,'DecreeType');
  const dn=mergeField(d,cur,'DecreeNumber');
  const dd=Object.prototype.hasOwnProperty.call(d,'DecreeDate')?(d.DecreeDate||null):toDateStr(cur.DecreeDate);
  const nt=mergeField(d,cur,'Notes');
  const isDissolution=dt==='حل الجمعية';
  if(isDissolution){
    const dup=await database.request().input('oid',sql.Int,cur.OrgID).input('id',sql.Int,id)
      .query(`SELECT LegID FROM Legislations WHERE OrgID=@oid AND DecreeType=N'حل الجمعية' AND ISNULL(IsDeleted,0)=0 AND LegID<>@id`);
    if(dup.recordset.length) return res.status(409).json({error:'هذه الجمعية اتحلّت بالفعل من قبل - لا يجوز تسجيل قرار حل مرة أخرى'});
  } else {
    const dup=await database.request().input('oid',sql.Int,cur.OrgID).input('dt',sql.NVarChar,dt)
      .input('dn',sql.NVarChar,dn).input('dd',sql.Date,dd).input('id',sql.Int,id)
      .query('SELECT LegID FROM Legislations WHERE OrgID=@oid AND DecreeType=@dt AND DecreeNumber=@dn AND DecreeDate=@dd AND ISNULL(IsDeleted,0)=0 AND LegID<>@id');
    if(dup.recordset.length)return res.status(409).json({error:`تم تسجيل قرار "${dt}" بنفس الرقم والتاريخ من قبل لهذه الجمعية`});
  }
  await database.request().input('id',sql.Int,id)
    .input('dt',sql.NVarChar,dt).input('dn',sql.NVarChar,dn)
    .input('dd',sql.Date,dd).input('nt',sql.NVarChar,nt)
    .query('UPDATE Legislations SET DecreeType=@dt,DecreeNumber=@dn,DecreeDate=@dd,Notes=@nt WHERE LegID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.delete('/api/legislations/:id',async(req,res)=>{try{
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const permChk=await assertCanManageDeptRecord(req.user,'Legislations','LegID',parseInt(req.params.id));
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  await(await db()).request().input('id',sql.Int,parseInt(req.params.id)).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE Legislations SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE LegID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ── BANNED ORGS ── (IsBanned و DissolutionInProgress أُضيفا بترقية 12_banned_orgs_upgrade.sql)
app.get('/api/banned/:orgId',async(req,res)=>{try{
  const id=parseInt(req.params.orgId)||0;
  const r=await(await db()).request().input('id',sql.Int,id)
    .query('SELECT* FROM BannedOrgs WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY BanID DESC');
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/banned',async(req,res)=>{try{
  const d=req.body;
  // نفس القاعدة بالظبط: نفس الجمعية + نفس رقم القرار + نفس سنة تاريخ القرار = تكرار مرفوض.
  // لو مفيش رقم قرار مكتوب، مفيش رقم تسلسلي نقارن بيه فنسمح بالحفظ (زي التشريعات والمنح).
  if(d.DecreeNumber){
    const dupYear=d.DecreeDate?new Date(d.DecreeDate).getFullYear():null;
    const dup=await(await db()).request().input('oid',sql.Int,d.OrgID).input('dn',sql.NVarChar,d.DecreeNumber)
      .input('dy',sql.Int,dupYear)
      .query('SELECT BanID FROM BannedOrgs WHERE OrgID=@oid AND DecreeNumber=@dn AND ISNULL(IsDeleted,0)=0 AND ISNULL(YEAR(DecreeDate),-1)=ISNULL(@dy,-1)');
    if(dup.recordset.length)return res.status(409).json({error:'تم تسجيل هذا القرار من قبل لنفس الجمعية ونفس السنة'});
  }
  const r=await(await db()).request()
    .input('oid',sql.Int,d.OrgID)
    .input('fc',sql.Bit,d.FundsConfiscated?1:0).input('ib',sql.Bit,d.IsBanned?1:0)
    .input('is2',sql.Bit,d.IsSuspended?1:0).input('hc',sql.Bit,d.HasCase?1:0)
    .input('cn',sql.NVarChar,d.CaseNumber||null)
    .input('dip',sql.Bit,d.DissolutionInProgress?1:0).input('ds',sql.Bit,d.DissolutionStatus?1:0)
    .input('dn',sql.NVarChar,d.DecreeNumber||null).input('dd',sql.Date,d.DecreeDate||null)
    .input('nt',sql.NVarChar,d.Notes||null)
    .input('dp',sql.NVarChar,d.Department||null).input('by',sql.Int,d.CreatedBy||null)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .query(`INSERT INTO BannedOrgs(OrgID,FundsConfiscated,IsBanned,IsSuspended,HasCase,CaseNumber,DissolutionInProgress,DissolutionStatus,DecreeNumber,DecreeDate,Notes,Department,CreatedBy,FilePath)
            OUTPUT INSERTED.BanID VALUES(@oid,@fc,@ib,@is2,@hc,@cn,@dip,@ds,@dn,@dd,@nt,@dp,@by,@fp)`);
  res.json({ok:true,BanID:r.recordset[0].BanID});
}catch(e){res.status(500).json({error:e.message});}});

app.put('/api/banned/:id',async(req,res)=>{try{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'BannedOrgs','BanID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const database=await db();
  const curR=await database.request().input('id',sql.Int,id).query('SELECT* FROM BannedOrgs WHERE BanID=@id');
  if(!curR.recordset.length) return res.status(404).json({error:'السجل غير موجود'});
  const cur=curR.recordset[0], d=req.body;
  const asBit=(key)=>{const v=mergeField(d,cur,key);return(v===true||v===1||v==='1')?1:0;};
  const fc=asBit('FundsConfiscated'), ib=asBit('IsBanned'), is2=asBit('IsSuspended'), hc=asBit('HasCase');
  const dip=asBit('DissolutionInProgress'), ds=asBit('DissolutionStatus');
  const cn=mergeField(d,cur,'CaseNumber'), dn=mergeField(d,cur,'DecreeNumber');
  const dd=Object.prototype.hasOwnProperty.call(d,'DecreeDate')?(d.DecreeDate||null):toDateStr(cur.DecreeDate);
  const nt=mergeField(d,cur,'Notes');
  await database.request().input('id',sql.Int,id)
    .input('fc',sql.Bit,fc).input('ib',sql.Bit,ib)
    .input('is2',sql.Bit,is2).input('hc',sql.Bit,hc)
    .input('cn',sql.NVarChar,cn)
    .input('dip',sql.Bit,dip).input('ds',sql.Bit,ds)
    .input('dn',sql.NVarChar,dn).input('dd',sql.Date,dd)
    .input('nt',sql.NVarChar,nt)
    .query(`UPDATE BannedOrgs SET FundsConfiscated=@fc,IsBanned=@ib,IsSuspended=@is2,HasCase=@hc,CaseNumber=@cn,
            DissolutionInProgress=@dip,DissolutionStatus=@ds,DecreeNumber=@dn,DecreeDate=@dd,Notes=@nt WHERE BanID=@id`);
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.delete('/api/banned/:id',async(req,res)=>{try{
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const permChk=await assertCanManageDeptRecord(req.user,'BannedOrgs','BanID',parseInt(req.params.id));
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  await(await db()).request().input('id',sql.Int,parseInt(req.params.id)).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE BannedOrgs SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE BanID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ── تعديل/حذف ترخيص جمع مال (ملحوظة: دي كانت ناقصة تمامًا من قبل - مكنش فيه Endpoint خالص
//    لتعديل أو حذف ترخيص بعد إضافته، وده سبب مشكلة "تعديل ترخيص جمع المال" اللي واجهتك قبل كده) ──
app.put('/api/licenses/:id',async(req,res)=>{try{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'FundraisingLicenses','LicID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const database=await db();
  // ══ الإصلاح الجذري لعطل الإحصاء ══
  // شاشة "تعديل بيانات إدارية - جمع المال" (وغيرها من نقاط التعديل) ممكن تبعت بعض
  // الحقول بس مش كلها. قبل كده كان أي حقل غير مُرسَل (زي تاريخ/شهر/سنة الإصدار) يترجم
  // NULL في قاعدة البيانات فورًا، وبما إن كل تقارير جمع المال (شهري/سنوي/ربع سنوي)
  // معتمدة بالكامل على IssueMonth/IssueYear/LiquidationMonth/LiquidationYear، كان الترخيص
  // بيختفي من الإحصاء بمجرد أي تعديل عليه رغم إن بياناته سليمة. الحل: نجيب السجل الحالي
  // أولاً، وأي حقل ميجيش في طلب الحفظ يفضل بقيمته الأصلية.
  const curR=await database.request().input('id',sql.Int,id).query('SELECT* FROM FundraisingLicenses WHERE LicID=@id');
  if(!curR.recordset.length) return res.status(404).json({error:'الترخيص غير موجود'});
  const cur=curR.recordset[0], d=req.body;
  const licNum=mergeField(d,cur,'LicenseNumber');
  const licStatus=mergeField(d,cur,'LicenseStatus','LicenseStatus')||'ساري';
  const issueDate=Object.prototype.hasOwnProperty.call(d,'IssueDate')?(d.IssueDate||null):toDateStr(cur.IssueDate);
  const startDate=Object.prototype.hasOwnProperty.call(d,'StartDate')?(d.StartDate||null):toDateStr(cur.StartDate);
  const endDate=Object.prototype.hasOwnProperty.call(d,'EndDate')?(d.EndDate||null):toDateStr(cur.EndDate);
  const liqDate=Object.prototype.hasOwnProperty.call(d,'LiquidationDate')?(d.LiquidationDate||null):toDateStr(cur.LiquidationDate);
  // شهر/سنة الإصدار والتصفية: مصدر الحقيقة هو التاريخ الكامل نفسه أولاً (يعاد حسابه دايمًا
  // من التاريخ المدموج أعلاه)، ولو معندناش تاريخ خالص نرجع لقيمة IssueMonth/Year المرسلة
  // صراحةً من الواجهة، ولو دي كمان مش موجودة نحافظ على القيمة الأصلية المخزّنة بالفعل.
  const issueP=ymParts(issueDate), liqP=ymParts(liqDate);
  const issueMonth=issueP?issueP.m:mergeField(d,cur,'IssueMonth');
  const issueYear=issueP?issueP.y:mergeField(d,cur,'IssueYear');
  const liqMonth=liqP?liqP.m:mergeField(d,cur,'LiquidationMonth');
  const liqYear=liqP?liqP.y:mergeField(d,cur,'LiquidationYear');
  const revenue=Object.prototype.hasOwnProperty.call(d,'Revenue')?(d.Revenue||0):cur.Revenue;
  const expenses=Object.prototype.hasOwnProperty.call(d,'Expenses')?(d.Expenses||0):cur.Expenses;
  // (إصلاح) الصافي (NetAmount) عمود يُكتب يدويًا (ترقية 18) - قبل كده الكويري تحت كانت
  // ناسية عمود NetAmount خالص، فأي تعديل للصافي من شاشة "تعديل بيانات إدارية" كان بيظهر
  // إنه اتحفظ بنجاح في الواجهة لكن مايتسجّلش في القاعدة فعليًا، فيفضل الصافي زي ما هو
  // (غالبًا صفر) مهما عدّلتيه. لو الحقل مش مُرسَل نحافظ على القيمة الأصلية زي باقي الحقول.
  const netAmount=Object.prototype.hasOwnProperty.call(d,'NetAmount')
    ?((d.NetAmount!==null&&d.NetAmount!=='')?d.NetAmount:null)
    :cur.NetAmount;
  const liqStatus=mergeField(d,cur,'LiquidationStatus');
  const dataType=mergeField(d,cur,'DataType')||'جديدة';
  const methods=Object.prototype.hasOwnProperty.call(d,'CollectionMethods')?toCsv(d.CollectionMethods):cur.CollectionMethods;
  const purpose=Object.prototype.hasOwnProperty.call(d,'LicensePurpose')?toCsv(d.LicensePurpose):cur.LicensePurpose;
  await database.request().input('id',sql.Int,id)
    .input('ln',sql.NVarChar,licNum).input('ls',sql.NVarChar,licStatus)
    .input('id2',sql.Date,issueDate).input('im',sql.Int,issueMonth).input('iy',sql.Int,issueYear)
    .input('sd',sql.Date,startDate).input('ed',sql.Date,endDate)
    .input('ld',sql.Date,liqDate).input('lm',sql.Int,liqMonth).input('ly',sql.Int,liqYear)
    .input('rv',sql.Decimal(18,2),revenue).input('ex',sql.Decimal(18,2),expenses)
    .input('na',sql.Decimal(18,2),netAmount)
    .input('lq',sql.NVarChar,liqStatus).input('dt',sql.NVarChar,dataType)
    .input('cm',sql.NVarChar,methods).input('lp',sql.NVarChar,purpose)
    .query(`UPDATE FundraisingLicenses SET LicenseNumber=@ln,LicenseStatus=@ls,IssueDate=@id2,IssueMonth=@im,IssueYear=@iy,
      StartDate=@sd,EndDate=@ed,LiquidationDate=@ld,LiquidationMonth=@lm,LiquidationYear=@ly,Revenue=@rv,Expenses=@ex,
      NetAmount=@na,LiquidationStatus=@lq,DataType=@dt,CollectionMethods=@cm,LicensePurpose=@lp WHERE LicID=@id`);
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.delete('/api/licenses/:id',async(req,res)=>{try{
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const permChk=await assertCanManageDeptRecord(req.user,'FundraisingLicenses','LicID',parseInt(req.params.id));
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  await(await db()).request().input('id',sql.Int,parseInt(req.params.id)).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE FundraisingLicenses SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE LicID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════════════════════════════════
// ══ بيانات إدارية أخرى: (1) الحالات  (2) الشركات (تراخيص المسابقات) ══
// ملاحظة معمارية مهمة: على عكس كل الإدارات اللي فوق (جمع المال/المنح/التشريعات/المحظورة)
// دي مش مرتبطة بجمعية (OrgID) - "الحالة" و"الشركة" كيان مستقل قائم بذاته (بالظبط زي جدول
// OtherPartyEvents الموجود فوق - جهة أخرى مش جمعية). فبالتالي معندهاش JOIN مع Organizations
// خالص لا في البحث ولا في التسجيل ولا في الإحصاء - عشان محدش يحاول يربطها بمعرّف جمعية بالغلط.
// كل جدول بينشئ نفسه أول مرة يتنادى عليه (نفس أسلوب OtherPartyEvents) عشان محتاجش Migration يدوي.
// ══════════════════════════════════════════════════════════════════════════════
const ENSURE_ADMIN_CASES_SQL=`CREATE TABLE AdminCases(
  CaseID INT IDENTITY(1,1) PRIMARY KEY,
  CaseCode NVARCHAR(50), CaseName NVARCHAR(300) NOT NULL, Subject NVARCHAR(300),
  RequestDate DATE, PatientCondition NVARCHAR(300), Age NVARCHAR(50), Applicant NVARCHAR(300),
  NationalSecurityLetter NVARCHAR(300), NationalIntelligenceLetter NVARCHAR(300),
  Phone NVARCHAR(50), HealthMinistryLetter NVARCHAR(300), HealthMinistryReply NVARCHAR(300),
  CollectionMethods NVARCHAR(300), CollectionPeriod NVARCHAR(300),
  DecisionNumber NVARCHAR(100), DecisionDate DATE, DecisionYear INT, DecisionText NVARCHAR(1000),
  Notes NVARCHAR(1000), Department NVARCHAR(100), FilePath NVARCHAR(1000),
  CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(),
  IsDeleted BIT NOT NULL DEFAULT 0, DeleteReason NVARCHAR(500), DeletedBy INT, DeletedAt DATETIME)`;
const ENSURE_ADMIN_COMPANIES_SQL=`CREATE TABLE AdminCompanies(
  CompanyID INT IDENTITY(1,1) PRIMARY KEY,
  CompanyName NVARCHAR(300) NOT NULL, Subject NVARCHAR(300),
  LicenseNumber NVARCHAR(100), LicenseYear INT,
  ActiveMonth INT, ActiveYear INT,
  PeriodFrom DATE, PeriodTo DATE,
  PrizesValue DECIMAL(18,2), TotalCollected DECIMAL(18,2), Amount15 DECIMAL(18,2),
  NasserBank NVARCHAR(200), LiqDay INT, LiqMonth INT, LiqYear INT,
  Notes NVARCHAR(1000), Department NVARCHAR(100), FilePath NVARCHAR(1000),
  CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(),
  IsDeleted BIT NOT NULL DEFAULT 0, DeleteReason NVARCHAR(500), DeletedBy INT, DeletedAt DATETIME)`;
async function ensureAdminOtherTable(name){
  const sqlText = name==='AdminCases' ? ENSURE_ADMIN_CASES_SQL : ENSURE_ADMIN_COMPANIES_SQL;
  try{
    await(await db()).request().query(`IF OBJECT_ID('${name}','U') IS NULL ${sqlText}`);
  }catch(e){
    // ── إصلاح تسابق (race condition): لو طلبين وصلوا في نفس اللحظة (مثلاً فتح صفحة
    // "بيانات إدارية أخرى" بيستدعي بحث الحالات والشركات مع بعض في نفس الوقت) ممكن
    // الاتنين يشوفوا إن الجدول مش موجود ويحاولوا ينشئوه سوا - يبقى واحد بس ينجح والتاني
    // ياخد "There is already an object..." وده مش خطأ حقيقي، معناه إن الجدول بقى موجود
    // فعلاً (حتى لو مش هو اللي عمله) - فنتجاهله ونكمل عادي بدل ما نوقّف الطلب بخطأ 500.
    if(!/There is already an object/i.test(e.message)) throw e;
  }
}
// دالة عامة تلتقط "الجدول مش موجود" أو "عمود ناقص" في أي endpoint تحت وتصلحه تلقائيًا ثم تعيد المحاولة مرة واحدة
async function withAdminOtherAutoFix(res, fn){
  try{ return await fn(); }
  catch(e){
    if(e.message.includes('Invalid object name')){
      try{ await ensureAdminOtherTable('AdminCases'); await ensureAdminOtherTable('AdminCompanies'); return await fn(); }
      catch(e2){ res.status(500).json({error:e2.message}); return undefined; }
    }
    res.status(500).json({error:e.message}); return undefined;
  }
}

// ── الحالات: قائمة/بحث ──
// فلاتر: caseName, subject, decisionNumber, year (سنة القرار), fromYear/toYear
app.get('/api/admin-cases',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const{caseName,subject,decisionNumber,year,fromYear,toYear}=req.query;
  const d=await db();const r=d.request();
  let q='SELECT* FROM AdminCases WHERE ISNULL(IsDeleted,0)=0';
  if(caseName){q+=' AND CaseName LIKE @cn';r.input('cn',sql.NVarChar,'%'+caseName+'%');}
  if(subject){q+=' AND Subject LIKE @sb';r.input('sb',sql.NVarChar,'%'+subject+'%');}
  if(decisionNumber){q+=' AND DecisionNumber LIKE @dn';r.input('dn',sql.NVarChar,'%'+decisionNumber+'%');}
  if(year){q+=' AND DecisionYear=@yr';r.input('yr',sql.Int,parseInt(year));}
  if(fromYear){q+=' AND DecisionYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
  if(toYear){q+=' AND DecisionYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
  q+=' ORDER BY CaseID DESC';
  res.json((await r.query(q)).recordset);
});});

app.get('/api/admin-cases/:id',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const id=parseInt(req.params.id)||0;
  const r=await(await db()).request().input('id',sql.Int,id).query('SELECT* FROM AdminCases WHERE CaseID=@id AND ISNULL(IsDeleted,0)=0');
  if(!r.recordset.length) return res.status(404).json({error:'الحالة غير موجودة'});
  res.json(r.recordset[0]);
});});

app.post('/api/admin-cases',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const d=req.body; const database=await db();
  if(!d.CaseName) return res.status(400).json({error:'اسم الحالة إجباري'});
  const decP=ymParts(d.DecisionDate);
  const decisionYear=(decP?decP.y:null)||d.DecisionYear||null;
  // ── منع التكرار الأساسي بقى على "رقم الحالة" (كود) - لأنه العنصر الوحيد المتاح لكل
  // حالة من أول تسجيلها (حتى لو لسه ملهاش قرار وزاري خالص - وده حال أغلب الحالات فعلاً).
  // رقم/تاريخ القرار بقوا اختياريين تمامًا في التسجيل، مش شرط لوجود الحالة أصلاً.
  // (تصحيح) كان ده منع باتّ (409 نهائي من غير أي طريقة تجاوز) - فكان بيرفض تسجيل إخوة/توأم
  // ليهم نفس كود الحالة العائلي (حالة شائعة فعلاً في البيانات)، فكان مضطرين يسيبوا الكود فاضي
  // عشان يقدروا يسجّلوا أصلاً. دلوقتي: نفس مبدأ تحذير رقم القرار تحت - تحذير قابل للتأكيد
  // (ConfirmDuplicate) مش رفض تلقائي، عشان تقدر تأكدي "أيوة ده أخ/أخت" وتكمّلي التسجيل.
  if(d.CaseCode && !d.ConfirmDuplicate){
    const dupCode=await database.request().input('cc',sql.NVarChar,String(d.CaseCode).trim())
      .query(`SELECT CaseID,CaseName FROM AdminCases WHERE ISNULL(IsDeleted,0)=0 AND CaseCode=@cc`);
    if(dupCode.recordset.length){
      const names=dupCode.recordset.map(x=>`#${x.CaseID} - ${x.CaseName}`).join('، ');
      return res.status(409).json({error:`⚠️ رقم الحالة "${d.CaseCode}" مسجَّل بالفعل لـ: ${names}. لو دي نفس الحالة (تكرار) - راجعي البيانات. ولو دي حالة تانية فعلاً (زي أخ/أخت تحت نفس الكود العائلي) - أكّدي التسجيل.`,duplicateWarning:true,matches:dupCode.recordset});
    }
  }
  // ── تنبيه إضافي (اختياري) لو اتسجل رقم وتاريخ قرار: تنبيه قابل للتأكيد مش رفض تلقائي
  // صامت - لأن الاعتماد على تطابق اسم الحالة حرفيًا خطر (لو الاسم اتكتب مرة بحرف زيادة أو
  // ناقص هيفوّت تكرار حقيقي من غير إنذار). فبقى المنطق كده: أي حالة (أيًا كان اسمها) بنفس
  // رقم القرار ونفس تاريخه بالظبط بتتحسب "تشابه" وبتظهر كتنبيه فيه اسم الحالة/الحالات
  // الموجودة عشان المستخدم نفسه يقرر بعينه: ده تكرار فعلي ولا حالة تانية حقيقية تحت نفس
  // القرار (زي توأم/أشقاء) - ولو أكدت إنه مش تكرار (ConfirmDuplicate:true) تتسجل عادي.
  if(d.DecisionNumber && d.DecisionDate && !d.ConfirmDuplicate){
    const sim=await database.request().input('dn',sql.NVarChar,String(d.DecisionNumber).trim())
      .input('dd',sql.Date,d.DecisionDate)
      .query(`SELECT CaseID,CaseName FROM AdminCases WHERE ISNULL(IsDeleted,0)=0 AND DecisionNumber=@dn AND DecisionDate=@dd`);
    if(sim.recordset.length){
      const names=sim.recordset.map(x=>`#${x.CaseID} - ${x.CaseName}`).join('، ');
      return res.status(409).json({error:`⚠️ في حالة/حالات مسجَّلة بالفعل بنفس رقم القرار "${d.DecisionNumber}" وبنفس التاريخ: ${names}. لو دي نفس الحالة (تكرار) - راجعي البيانات. ولو دي حالة تانية فعلاً (زي توأم تحت نفس القرار) - أكّدي التسجيل.`,duplicateWarning:true,matches:sim.recordset});
    }
  }
  const r=await database.request()
    .input('cc',sql.NVarChar,d.CaseCode||null).input('cn',sql.NVarChar,d.CaseName).input('sb',sql.NVarChar,d.Subject||null)
    .input('rd',sql.Date,d.RequestDate||null).input('pc',sql.NVarChar,d.PatientCondition||null).input('ag',sql.NVarChar,d.Age||null)
    .input('ap',sql.NVarChar,d.Applicant||null)
    .input('ns',sql.NVarChar,d.NationalSecurityLetter||null).input('ni',sql.NVarChar,d.NationalIntelligenceLetter||null)
    .input('ph',sql.NVarChar,d.Phone||null).input('hl',sql.NVarChar,d.HealthMinistryLetter||null).input('hr',sql.NVarChar,d.HealthMinistryReply||null)
    .input('cm',sql.NVarChar,toCsv(d.CollectionMethods)).input('cp',sql.NVarChar,d.CollectionPeriod||null)
    .input('dn',sql.NVarChar,d.DecisionNumber||null).input('dd',sql.Date,d.DecisionDate||null).input('dy',sql.Int,decisionYear)
    .input('dt',sql.NVarChar,d.DecisionText||null).input('nt',sql.NVarChar,d.Notes||null)
    .input('dp',sql.NVarChar,d.Department||null).input('by',sql.Int,req.user.id).input('fp',sql.NVarChar,d.FilePath||null)
    .query(`INSERT INTO AdminCases(CaseCode,CaseName,Subject,RequestDate,PatientCondition,Age,Applicant,
      NationalSecurityLetter,NationalIntelligenceLetter,Phone,HealthMinistryLetter,HealthMinistryReply,
      CollectionMethods,CollectionPeriod,DecisionNumber,DecisionDate,DecisionYear,DecisionText,Notes,
      Department,CreatedBy,FilePath)
      OUTPUT INSERTED.CaseID
      VALUES(@cc,@cn,@sb,@rd,@pc,@ag,@ap,@ns,@ni,@ph,@hl,@hr,@cm,@cp,@dn,@dd,@dy,@dt,@nt,@dp,@by,@fp)`);
  res.json({ok:true,CaseID:r.recordset[0].CaseID});
});});

app.put('/api/admin-cases/:id',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'AdminCases','CaseID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const database=await db();
  const curR=await database.request().input('id',sql.Int,id).query('SELECT* FROM AdminCases WHERE CaseID=@id');
  if(!curR.recordset.length) return res.status(404).json({error:'الحالة غير موجودة'});
  const cur=curR.recordset[0], d=req.body;
  // نفس مبدأ mergeField المطبَّق على كل الإدارات: أي خانة ميبعتهاش نموذج التعديل تفضل بقيمتها الأصلية
  const decisionDate=Object.prototype.hasOwnProperty.call(d,'DecisionDate')?(d.DecisionDate||null):toDateStr(cur.DecisionDate);
  const decP=ymParts(decisionDate);
  const decisionYear=decP?decP.y:mergeField(d,cur,'DecisionYear');
  const decisionNumber=mergeField(d,cur,'DecisionNumber');
  const caseName=mergeField(d,cur,'CaseName');
  const caseCode=mergeField(d,cur,'CaseCode');
  // ── منع تكرار "رقم الحالة" (كود) - نفس مبدأ التسجيل، بيتحقق بس لو الخانة اتبعتت/اتغيرت ──
  // (تصحيح) نفس تعديل التسجيل: تحذير قابل للتأكيد بدل رفض باتّ، عشان حالة الإخوة/التوأم.
  if(caseCode && Object.prototype.hasOwnProperty.call(d,'CaseCode') && !d.ConfirmDuplicate){
    const dupCode=await database.request().input('id',sql.Int,id).input('cc',sql.NVarChar,String(caseCode).trim())
      .query(`SELECT CaseID,CaseName FROM AdminCases WHERE ISNULL(IsDeleted,0)=0 AND CaseID<>@id AND CaseCode=@cc`);
    if(dupCode.recordset.length){
      const names=dupCode.recordset.map(x=>`#${x.CaseID} - ${x.CaseName}`).join('، ');
      return res.status(409).json({error:`⚠️ رقم الحالة "${caseCode}" مسجَّل بالفعل لـ: ${names}. لو دي نفس الحالة (تكرار) - راجعي البيانات. ولو دي حالة تانية فعلاً (زي أخ/أخت تحت نفس الكود العائلي) - أكّدي التسجيل.`,duplicateWarning:true,matches:dupCode.recordset});
    }
  }
  if(decisionNumber && decisionDate && !d.ConfirmDuplicate){
    const sim=await database.request().input('id',sql.Int,id).input('dn',sql.NVarChar,String(decisionNumber).trim())
      .input('dd',sql.Date,decisionDate)
      .query(`SELECT CaseID,CaseName FROM AdminCases WHERE ISNULL(IsDeleted,0)=0 AND CaseID<>@id AND DecisionNumber=@dn AND DecisionDate=@dd`);
    if(sim.recordset.length){
      const names=sim.recordset.map(x=>`#${x.CaseID} - ${x.CaseName}`).join('، ');
      return res.status(409).json({error:`⚠️ في حالة/حالات مسجَّلة بالفعل بنفس رقم القرار "${decisionNumber}" وبنفس التاريخ: ${names}. لو دي نفس الحالة (تكرار) - راجعي البيانات. ولو دي حالة تانية فعلاً - أكّدي التسجيل.`,duplicateWarning:true,matches:sim.recordset});
    }
  }
  await database.request().input('id',sql.Int,id)
    .input('cc',sql.NVarChar,mergeField(d,cur,'CaseCode')).input('cn',sql.NVarChar,mergeField(d,cur,'CaseName'))
    .input('sb',sql.NVarChar,mergeField(d,cur,'Subject'))
    .input('rd',sql.Date,Object.prototype.hasOwnProperty.call(d,'RequestDate')?(d.RequestDate||null):toDateStr(cur.RequestDate))
    .input('pc',sql.NVarChar,mergeField(d,cur,'PatientCondition')).input('ag',sql.NVarChar,mergeField(d,cur,'Age'))
    .input('ap',sql.NVarChar,mergeField(d,cur,'Applicant'))
    .input('ns',sql.NVarChar,mergeField(d,cur,'NationalSecurityLetter')).input('ni',sql.NVarChar,mergeField(d,cur,'NationalIntelligenceLetter'))
    .input('ph',sql.NVarChar,mergeField(d,cur,'Phone')).input('hl',sql.NVarChar,mergeField(d,cur,'HealthMinistryLetter'))
    .input('hr',sql.NVarChar,mergeField(d,cur,'HealthMinistryReply'))
    .input('cm',sql.NVarChar,Object.prototype.hasOwnProperty.call(d,'CollectionMethods')?toCsv(d.CollectionMethods):cur.CollectionMethods)
    .input('cp',sql.NVarChar,mergeField(d,cur,'CollectionPeriod'))
    .input('dn',sql.NVarChar,decisionNumber).input('dd',sql.Date,decisionDate).input('dy',sql.Int,decisionYear)
    .input('dt',sql.NVarChar,mergeField(d,cur,'DecisionText')).input('nt',sql.NVarChar,mergeField(d,cur,'Notes'))
    .input('dp',sql.NVarChar,mergeField(d,cur,'Department')).input('fp',sql.NVarChar,mergeField(d,cur,'FilePath'))
    .query(`UPDATE AdminCases SET CaseCode=@cc,CaseName=@cn,Subject=@sb,RequestDate=@rd,PatientCondition=@pc,Age=@ag,
      Applicant=@ap,NationalSecurityLetter=@ns,NationalIntelligenceLetter=@ni,Phone=@ph,HealthMinistryLetter=@hl,
      HealthMinistryReply=@hr,CollectionMethods=@cm,CollectionPeriod=@cp,DecisionNumber=@dn,DecisionDate=@dd,
      DecisionYear=@dy,DecisionText=@dt,Notes=@nt,Department=@dp,FilePath=@fp WHERE CaseID=@id`);
  res.json({ok:true});
});});

// ── 🔄 تجديد القرار: إضافة قرار جديد لحالة موجودة بالفعل من غير ما تحتاجي تعيدي كتابة
// اسم الحالة أو الكود أو أي بيانات تانية. القرار القديم بيتحفظ تلقائيًا في نص القرار
// الأرشيفي (DecisionText)، والقرار الجديد بيبقى هو "القرار الحالي" (DecisionNumber/Date). ──
app.post('/api/admin-cases/:id/renew-decision',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'AdminCases','CaseID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const d=req.body;
  if(!d.NewDecisionNumber || !d.NewDecisionDate) return res.status(400).json({error:'رقم القرار الجديد وتاريخه إجباريان للتجديد'});
  const database=await db();
  const curR=await database.request().input('id',sql.Int,id).query('SELECT* FROM AdminCases WHERE CaseID=@id AND ISNULL(IsDeleted,0)=0');
  if(!curR.recordset.length) return res.status(404).json({error:'الحالة غير موجودة'});
  const cur=curR.recordset[0];
  const newNum=String(d.NewDecisionNumber).trim(), newDate=d.NewDecisionDate;
  // ── نفس تنبيه التشابه بتاع التسجيل العادي، عشان لو رقم القرار الجديد ده اتسجل غلط قبل
  // كده لحالة تانية بالغلط، المستخدم ياخد باله - قابل للتأكيد زي أي تنبيه تشابه تاني. ──
  if(!d.ConfirmDuplicate){
    const sim=await database.request().input('id',sql.Int,id).input('dn',sql.NVarChar,newNum).input('dd',sql.Date,newDate)
      .query(`SELECT CaseID,CaseName FROM AdminCases WHERE ISNULL(IsDeleted,0)=0 AND CaseID<>@id AND DecisionNumber=@dn AND DecisionDate=@dd`);
    if(sim.recordset.length){
      const names=sim.recordset.map(x=>`#${x.CaseID} - ${x.CaseName}`).join('، ');
      return res.status(409).json({error:`⚠️ في حالة/حالات مسجَّلة بالفعل بنفس رقم القرار "${newNum}" وبنفس التاريخ: ${names}. راجعي الرقم، أو أكّدي لو ده صحيح فعلاً.`,duplicateWarning:true,matches:sim.recordset});
    }
  }
  const oldSummary = cur.DecisionNumber ? `رقم ${cur.DecisionNumber} بتاريخ ${toDateStr(cur.DecisionDate)}` : null;
  const newSummary = `رقم ${newNum} بتاريخ ${newDate}`;
  const newText = cur.DecisionText
    ? `${cur.DecisionText} ، تجديد ${newSummary}`
    : (oldSummary ? `${oldSummary} ، تجديد ${newSummary}` : newSummary);
  const decYear = parseInt(String(newDate).slice(0,4));
  await database.request().input('id',sql.Int,id)
    .input('dn',sql.NVarChar,newNum).input('dd',sql.Date,newDate).input('dy',sql.Int,decYear)
    .input('dt',sql.NVarChar,newText).input('note',sql.NVarChar,d.RenewalNote?String(d.RenewalNote).trim():null)
    .query(`UPDATE AdminCases SET DecisionNumber=@dn,DecisionDate=@dd,DecisionYear=@dy,DecisionText=@dt,
      Notes=CASE WHEN @note IS NOT NULL THEN ISNULL(Notes+' | ','')+@note ELSE Notes END
      WHERE CaseID=@id`);
  res.json({ok:true});
});});

app.delete('/api/admin-cases/:id',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'AdminCases','CaseID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  await(await db()).request().input('id',sql.Int,id).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE AdminCases SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE CaseID=@id');
  res.json({ok:true});
});});

// ── الشركات (تراخيص المسابقات): قائمة/بحث ──
app.get('/api/admin-companies',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const{companyName,subject,licenseNumber,year,fromYear,toYear}=req.query;
  const d=await db();const r=d.request();
  let q='SELECT* FROM AdminCompanies WHERE ISNULL(IsDeleted,0)=0';
  if(companyName){q+=' AND CompanyName LIKE @cn';r.input('cn',sql.NVarChar,'%'+companyName+'%');}
  if(subject){q+=' AND Subject LIKE @sb';r.input('sb',sql.NVarChar,'%'+subject+'%');}
  if(licenseNumber){q+=' AND LicenseNumber LIKE @ln';r.input('ln',sql.NVarChar,'%'+licenseNumber+'%');}
  if(year){q+=' AND LicenseYear=@yr';r.input('yr',sql.Int,parseInt(year));}
  if(fromYear){q+=' AND LicenseYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
  if(toYear){q+=' AND LicenseYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
  q+=' ORDER BY CompanyID DESC';
  res.json((await r.query(q)).recordset);
});});

app.get('/api/admin-companies/:id',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const id=parseInt(req.params.id)||0;
  const r=await(await db()).request().input('id',sql.Int,id).query('SELECT* FROM AdminCompanies WHERE CompanyID=@id AND ISNULL(IsDeleted,0)=0');
  if(!r.recordset.length) return res.status(404).json({error:'الشركة غير موجودة'});
  res.json(r.recordset[0]);
});});

app.post('/api/admin-companies',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const d=req.body; const database=await db();
  if(!d.CompanyName) return res.status(400).json({error:'اسم الشركة/الجهة إجباري'});
  const perP=ymParts(d.PeriodFrom);
  const licenseYear=d.LicenseYear||(perP?perP.y:null)||null;
  // ── منع التكرار: نفس رقم الترخيص + نفس سنة الترخيص = تكرار مرفوض (بالظبط زي تراخيص جمع
  // المال). نفس الرقم بسنة ترخيص مختلفة (تجديد سنوي) مسموح عادي. ──
  if(d.LicenseNumber){
    const dup=await database.request().input('ln',sql.NVarChar,String(d.LicenseNumber).trim())
      .input('ly',sql.Int,licenseYear)
      .query(`SELECT TOP 1 CompanyID,CompanyName FROM AdminCompanies WHERE ISNULL(IsDeleted,0)=0 AND LicenseNumber=@ln AND ISNULL(LicenseYear,-1)=ISNULL(@ly,-1)`);
    if(dup.recordset.length) return res.status(409).json({error:`⚠️ رقم الترخيص "${d.LicenseNumber}" لنفس سنة الترخيص مسجَّل بالفعل (${dup.recordset[0].CompanyName})`});
  }
  const r=await database.request()
    .input('cn',sql.NVarChar,d.CompanyName).input('sb',sql.NVarChar,d.Subject||null)
    .input('ln',sql.NVarChar,d.LicenseNumber||null).input('ly',sql.Int,licenseYear)
    .input('am',sql.Int,d.ActiveMonth||null).input('ay',sql.Int,d.ActiveYear||null)
    .input('pf',sql.Date,d.PeriodFrom||null).input('pt',sql.Date,d.PeriodTo||null)
    .input('pv',sql.Decimal(18,2),d.PrizesValue||null).input('tc',sql.Decimal(18,2),d.TotalCollected||null)
    .input('a15',sql.Decimal(18,2),(d.Amount15!==undefined&&d.Amount15!==null&&d.Amount15!=='')?d.Amount15:(d.TotalCollected?Math.round(d.TotalCollected*0.15*100)/100:null))
    .input('nb',sql.NVarChar,d.NasserBank||null)
    .input('ld',sql.Int,d.LiqDay||null).input('lm',sql.Int,d.LiqMonth||null).input('ly2',sql.Int,d.LiqYear||null)
    .input('nt',sql.NVarChar,d.Notes||null).input('dp',sql.NVarChar,d.Department||null)
    .input('by',sql.Int,req.user.id).input('fp',sql.NVarChar,d.FilePath||null)
    .query(`INSERT INTO AdminCompanies(CompanyName,Subject,LicenseNumber,LicenseYear,ActiveMonth,ActiveYear,
      PeriodFrom,PeriodTo,PrizesValue,TotalCollected,Amount15,NasserBank,LiqDay,LiqMonth,LiqYear,Notes,
      Department,CreatedBy,FilePath)
      OUTPUT INSERTED.CompanyID
      VALUES(@cn,@sb,@ln,@ly,@am,@ay,@pf,@pt,@pv,@tc,@a15,@nb,@ld,@lm,@ly2,@nt,@dp,@by,@fp)`);
  res.json({ok:true,CompanyID:r.recordset[0].CompanyID});
});});

app.put('/api/admin-companies/:id',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'AdminCompanies','CompanyID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const database=await db();
  const curR=await database.request().input('id',sql.Int,id).query('SELECT* FROM AdminCompanies WHERE CompanyID=@id');
  if(!curR.recordset.length) return res.status(404).json({error:'الشركة غير موجودة'});
  const cur=curR.recordset[0], d=req.body;
  const licenseNumber=mergeField(d,cur,'LicenseNumber');
  const licenseYear=mergeField(d,cur,'LicenseYear');
  if(licenseNumber && (Object.prototype.hasOwnProperty.call(d,'LicenseNumber')||Object.prototype.hasOwnProperty.call(d,'LicenseYear'))){
    const dup=await database.request().input('id',sql.Int,id).input('ln',sql.NVarChar,String(licenseNumber).trim())
      .input('ly',sql.Int,licenseYear)
      .query(`SELECT TOP 1 CompanyID,CompanyName FROM AdminCompanies WHERE ISNULL(IsDeleted,0)=0 AND CompanyID<>@id AND LicenseNumber=@ln AND ISNULL(LicenseYear,-1)=ISNULL(@ly,-1)`);
    if(dup.recordset.length) return res.status(409).json({error:`⚠️ رقم الترخيص "${licenseNumber}" لنفس سنة الترخيص مسجَّل بالفعل لشركة أخرى (${dup.recordset[0].CompanyName})`});
  }
  await database.request().input('id',sql.Int,id)
    .input('cn',sql.NVarChar,mergeField(d,cur,'CompanyName')).input('sb',sql.NVarChar,mergeField(d,cur,'Subject'))
    .input('ln',sql.NVarChar,licenseNumber).input('ly',sql.Int,licenseYear)
    .input('am',sql.Int,mergeField(d,cur,'ActiveMonth')).input('ay',sql.Int,mergeField(d,cur,'ActiveYear'))
    .input('pf',sql.Date,Object.prototype.hasOwnProperty.call(d,'PeriodFrom')?(d.PeriodFrom||null):toDateStr(cur.PeriodFrom))
    .input('pt',sql.Date,Object.prototype.hasOwnProperty.call(d,'PeriodTo')?(d.PeriodTo||null):toDateStr(cur.PeriodTo))
    .input('pv',sql.Decimal(18,2),mergeField(d,cur,'PrizesValue')).input('tc',sql.Decimal(18,2),mergeField(d,cur,'TotalCollected'))
    .input('a15',sql.Decimal(18,2),mergeField(d,cur,'Amount15')).input('nb',sql.NVarChar,mergeField(d,cur,'NasserBank'))
    .input('ld',sql.Int,mergeField(d,cur,'LiqDay')).input('lm',sql.Int,mergeField(d,cur,'LiqMonth')).input('ly2',sql.Int,mergeField(d,cur,'LiqYear'))
    .input('nt',sql.NVarChar,mergeField(d,cur,'Notes')).input('dp',sql.NVarChar,mergeField(d,cur,'Department'))
    .input('fp',sql.NVarChar,mergeField(d,cur,'FilePath'))
    .query(`UPDATE AdminCompanies SET CompanyName=@cn,Subject=@sb,LicenseNumber=@ln,LicenseYear=@ly,ActiveMonth=@am,
      ActiveYear=@ay,PeriodFrom=@pf,PeriodTo=@pt,PrizesValue=@pv,TotalCollected=@tc,Amount15=@a15,NasserBank=@nb,
      LiqDay=@ld,LiqMonth=@lm,LiqYear=@ly2,Notes=@nt,Department=@dp,FilePath=@fp WHERE CompanyID=@id`);
  res.json({ok:true});
});});

app.delete('/api/admin-companies/:id',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const id=parseInt(req.params.id);
  const permChk=await assertCanManageDeptRecord(req.user,'AdminCompanies','CompanyID',id);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  await(await db()).request().input('id',sql.Int,id).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE AdminCompanies SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE CompanyID=@id');
  res.json({ok:true});
});});

// ── بحث موحّد "بيانات إدارية أخرى" - يبحث في الحالات و/أو الشركات مع بعض ──
// kind: cases | companies | all (افتراضي: all). name يبحث في اسم الحالة أو اسم الشركة معًا لو all.
app.get('/api/admin-other/search',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const{kind,name,subject,refNum,year}=req.query;
  const k=kind||'all';
  const out={cases:[],companies:[]};
  const d=await db();
  if(k==='cases'||k==='all'){
    const r=d.request();
    let q='SELECT* FROM AdminCases WHERE ISNULL(IsDeleted,0)=0';
    if(name){q+=' AND CaseName LIKE @nm';r.input('nm',sql.NVarChar,'%'+name+'%');}
    if(subject){q+=' AND Subject LIKE @sb';r.input('sb',sql.NVarChar,'%'+subject+'%');}
    if(refNum){q+=' AND DecisionNumber LIKE @rn';r.input('rn',sql.NVarChar,'%'+refNum+'%');}
    if(year){q+=' AND DecisionYear=@yr';r.input('yr',sql.Int,parseInt(year));}
    q+=' ORDER BY CaseID DESC';
    out.cases=(await r.query(q)).recordset;
  }
  if(k==='companies'||k==='all'){
    const r=d.request();
    let q='SELECT* FROM AdminCompanies WHERE ISNULL(IsDeleted,0)=0';
    if(name){q+=' AND CompanyName LIKE @nm';r.input('nm',sql.NVarChar,'%'+name+'%');}
    if(subject){q+=' AND Subject LIKE @sb';r.input('sb',sql.NVarChar,'%'+subject+'%');}
    if(refNum){q+=' AND LicenseNumber LIKE @rn';r.input('rn',sql.NVarChar,'%'+refNum+'%');}
    if(year){q+=' AND LicenseYear=@yr';r.input('yr',sql.Int,parseInt(year));}
    q+=' ORDER BY CompanyID DESC';
    out.companies=(await r.query(q)).recordset;
  }
  res.json(out);
});});

// ── إحصاء "بيانات إدارية أخرى" - مستقل قائم بذاته، وبرضه صالح للدمج مع إحصاء الممتد الفعال
// والتقارير المرفوعة من شاشة الإحصاء الشامل (نفس فكرة "الدمج" الموجودة بالفعل في الموقع). ──
// kind: cases | companies | both (افتراضي: both) - لو both بيرجع الاتنين مع بعض + إجمالي مدموج.
app.get('/api/stats/admin-other',async(req,res)=>{await withAdminOtherAutoFix(res,async()=>{
  const{kind,year,fromYear,toYear,department}=req.query;
  const k=kind||'both';
  const d=await db();
  const out={};
  if(k==='cases'||k==='both'){
    const r=d.request();
    let q='SELECT COUNT(*) AS Total FROM AdminCases WHERE ISNULL(IsDeleted,0)=0';
    if(year){q+=' AND DecisionYear=@yr';r.input('yr',sql.Int,parseInt(year));}
    if(fromYear){q+=' AND DecisionYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
    if(toYear){q+=' AND DecisionYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
    if(department){q+=' AND Department=@dp';r.input('dp',sql.NVarChar,department);}
    out.cases={total:(await r.query(q)).recordset[0].Total||0};
  }
  if(k==='companies'||k==='both'){
    const r=d.request();
    let q=`SELECT COUNT(*) AS Total, SUM(TotalCollected) AS TotalCollected, SUM(Amount15) AS TotalAmount15
      FROM AdminCompanies WHERE ISNULL(IsDeleted,0)=0`;
    if(year){q+=' AND LicenseYear=@yr';r.input('yr',sql.Int,parseInt(year));}
    if(fromYear){q+=' AND LicenseYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
    if(toYear){q+=' AND LicenseYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
    if(department){q+=' AND Department=@dp';r.input('dp',sql.NVarChar,department);}
    const row=(await r.query(q)).recordset[0];
    out.companies={total:row.Total||0,totalCollected:row.TotalCollected||0,totalAmount15:row.TotalAmount15||0};
  }
  if(k==='both') out.combinedTotal=(out.cases?.total||0)+(out.companies?.total||0);
  res.json(out);
});});

// STATS
app.get('/api/stats/general',async(req,res)=>{try{
  const d=await db();
  // (تحسين أداء) الاستعلامات الستة دي مستقلة عن بعضها تمامًا (كل واحد بيعد من جدول
  // مختلف أو بشرط مختلف) - كانت بتتبعت واحد ورا التاني (await تلو الآخر)، يعني الوقت
  // الكلي لهذا الـ endpoint كان = مجموع وقت كل الاستعلامات الستة مع بعض. دلوقتي بتتبعت
  // كلها مرة واحدة بالتوازي عن طريق Promise.all، فالوقت الكلي بقى = وقت أبطأ استعلام
  // بس، مش المجموع. لازم كل استعلام ياخد request() جديد بتاعه (زي ما هو) عشان
  // مينفعش نفس الـ request object يُستخدم لأكتر من استعلام في نفس الوقت.
  const [o,f,leg,gr,pendingReq,byGov]=await Promise.all([
    d.request().query("SELECT COUNT(*)AS Total,SUM(CASE WHEN OrgType=N'جمعية'THEN 1 ELSE 0 END)AS Societies,SUM(CASE WHEN OrgType=N'مؤسسة'THEN 1 ELSE 0 END)AS Foundations,SUM(CASE WHEN OrgType=N'اتحاد'THEN 1 ELSE 0 END)AS Unions,SUM(CASE WHEN Level=N'مركزي'THEN 1 ELSE 0 END)AS Central,SUM(CASE WHEN Status=N'تحتاج مراجعة' THEN 1 ELSE 0 END)AS NeedsReview,SUM(CASE WHEN Status=N'موقوفة' THEN 1 ELSE 0 END)AS Suspended,SUM(CASE WHEN Status=N'رجعت لممارسة النشاط' THEN 1 ELSE 0 END)AS ReturnedToActivity,SUM(CASE WHEN Status=N'نشطة' THEN 1 ELSE 0 END)AS Active,SUM(CASE WHEN Status=N'منحلة' THEN 1 ELSE 0 END)AS Dissolved,SUM(CASE WHEN Status=N'تحت التأسيس' THEN 1 ELSE 0 END)AS UnderFormation,SUM(CASE WHEN DirFlagSuspended=1 THEN 1 ELSE 0 END)AS DirFlagged FROM Organizations WHERE IsActive=1"),
    d.request().query('SELECT COUNT(*)AS Total,SUM(Revenue)AS TotalRevenue,SUM(Expenses)AS TotalExpenses,SUM(NetAmount)AS TotalNet FROM FundraisingLicenses WHERE ISNULL(IsDeleted,0)=0'),
    d.request().query('SELECT COUNT(*)AS Total FROM Legislations WHERE ISNULL(IsDeleted,0)=0'),
    d.request().query('SELECT COUNT(*)AS Total,SUM(Amount)AS TotalAmount FROM Grants WHERE ISNULL(IsDeleted,0)=0'),
    d.request().query("SELECT COUNT(*)AS Total FROM AddRequests WHERE Status='pending'"),
    // (جديد) توزيع "المديرية" (غير المركزي) على كل محافظة - يُستخدم في "الإحصاء الشامل" بس
    d.request().query("SELECT Governorate,COUNT(*)AS Cnt FROM Organizations WHERE IsActive=1 AND Level=N'مديرية' GROUP BY Governorate ORDER BY Governorate")
  ]);
  res.json({organizations:o.recordset[0],fundraising:f.recordset[0],legislations:leg.recordset[0],grants:gr.recordset[0],pendingRequests:pendingReq.recordset[0].Total,byGovernorate:byGov.recordset});
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/stats/fundraising/monthly',async(req,res)=>{try{
  const{month,year}=req.query;
  const r=await(await db()).request().input('m',sql.Int,parseInt(month)).input('y',sql.Int,parseInt(year))
    .execute('SP_FundraisingMonthlyReport');
  res.json(r.recordsets);
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/stats/fundraising/annual',async(req,res)=>{try{
  const r=await(await db()).request().input('y',sql.Int,parseInt(req.query.year)).execute('SP_FundraisingAnnualReport');
  res.json({summary:r.recordsets[0][0],details:r.recordsets[1]});
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/stats/fundraising/quarterly',async(req,res)=>{try{
  const y=parseInt(req.query.year),q=parseInt(req.query.quarter);
  const months={1:[1,2,3],2:[4,5,6],3:[7,8,9],4:[10,11,12]};
  const qm=months[q]||[4,5,6];
  const r=await(await db()).request().input('y',sql.Int,y).input('m1',sql.Int,qm[0]).input('m3',sql.Int,qm[2])
    // ══ إصلاح جذري (v20) ══
    // كان "التصفيات الفعلية/الصافي/الإيرادات" لهذا الربع بيتحسبوا بمطابقة LiquidationYear/
    // LiquidationMonth على ربع التقرير نفسه. لكن مهلة التصفية 60 يوم بعد نهاية مدة الترخيص
    // بتخلي تاريخ التصفية الفعلي يقع غالبًا في ربع/سنة تالية للترخيص، فالنتيجة كانت صفر
    // دايمًا مهما كانت البيانات صحيحة (نفس عطل الداشبورد في الواجهة - إصلاح NGO_Complete v22).
    // الصح: من ضمن التراخيص الصادرة في هذا الربع (IssueYear/IssueMonth)، إد ايه منها اتصفّى
    // فعليًا (عنده LiquidationDate) - بغض النظر عن الربع/السنة التقويمية اللي وقعت فيها التصفية.
    .query(`SELECT
      COUNT(*)AS TotalLicenses,
      SUM(CASE WHEN IssueYear=@y AND IssueMonth BETWEEN @m1 AND @m3 THEN 1 ELSE 0 END)AS IssuedThisQuarter,
      SUM(CASE WHEN IssueYear=@y AND IssueMonth BETWEEN @m1 AND @m3 AND LiquidationDate IS NOT NULL THEN 1 ELSE 0 END)AS TotalLiquidated,
      SUM(CASE WHEN IssueYear=@y AND IssueMonth BETWEEN @m1 AND @m3 AND LiquidationDate IS NOT NULL THEN Revenue ELSE 0 END)AS TotalRevenue,
      SUM(CASE WHEN IssueYear=@y AND IssueMonth BETWEEN @m1 AND @m3 AND LiquidationDate IS NOT NULL THEN Expenses ELSE 0 END)AS TotalExpenses,
      SUM(CASE WHEN IssueYear=@y AND IssueMonth BETWEEN @m1 AND @m3 AND LiquidationDate IS NOT NULL THEN NetAmount ELSE 0 END)AS TotalNet,
      SUM(CASE WHEN IssueYear=@y AND IssueMonth BETWEEN @m1 AND @m3 AND LiquidationDate<=Deadline60 THEN 1 ELSE 0 END)AS WithinDeadline,
      SUM(CASE WHEN IssueYear=@y AND IssueMonth BETWEEN @m1 AND @m3 AND LiquidationDate>Deadline60 THEN 1 ELSE 0 END)AS AfterDeadline,
      SUM(CASE WHEN IssueYear=@y AND IssueMonth BETWEEN @m1 AND @m3 AND LiquidationDate IS NULL THEN 1 ELSE 0 END)AS NotLiquidated,
      SUM(CASE WHEN DataType=N'جديدة' THEN 1 ELSE 0 END)AS NewData,
      SUM(CASE WHEN DataType=N'قديمة' THEN 1 ELSE 0 END)AS OldData
      FROM FundraisingLicenses WHERE ISNULL(IsDeleted,0)=0`);
  res.json({quarter:q,year:y,months:qm,...r.recordset[0]});
}catch(e){res.status(500).json({error:e.message});}});

// EVENTS
// ══ قائمة كل الأحداث الإدارية (لكل الجمعيات) - تُستخدم في صفحة البحث الموحّدة ══
app.get('/api/events',async(req,res)=>{try{
  const{regNum,dept,from,to,status,important,urgent,eventType,inNum,name,sender,receiver,createdFrom,createdTo,createdDay}=req.query;
  const d=await db();const r=d.request();
  let q=`SELECT e.EventID,e.OrgID,e.EventType,e.Subject,e.EventDate,e.Department,e.RecordedBy,
    e.IncomingNum,e.IncomingDate,e.Receiver,e.Actions,e.Status,e.IsImportant,e.IsUrgent,e.FilePath,
    e.SenderName,e.CreatedAt,
    o.OrgName,o.RegNum,o.RegYear,o.Governorate
    FROM OrgEvents e JOIN Organizations o ON e.OrgID=o.OrgID WHERE ISNULL(e.IsDeleted,0)=0`;
  if(regNum){q+=' AND CAST(o.RegNum AS NVARCHAR) LIKE @rn';r.input('rn',sql.NVarChar,'%'+regNum+'%');}
  if(dept){q+=' AND e.Department=@dp';r.input('dp',sql.NVarChar,dept);}
  if(from){q+=' AND e.EventDate>=@fr';r.input('fr',sql.Date,from);}
  if(to){q+=' AND e.EventDate<=@to';r.input('to',sql.Date,to);}
  if(status){q+=' AND e.Status=@st';r.input('st',sql.NVarChar,status);}
  if(eventType){q+=' AND e.EventType=@et2';r.input('et2',sql.NVarChar,eventType);}
  if(inNum){q+=' AND e.IncomingNum LIKE @in';r.input('in',sql.NVarChar,'%'+inNum+'%');}
  if(name){q+=' AND o.OrgName LIKE @nm';r.input('nm',sql.NVarChar,'%'+name+'%');}
  // (جديد) بحث بالجهة المرسلة (SenderName) - نفس فكرة البحث بالاسم لكن على عمود المرسل
  if(sender){q+=' AND e.SenderName LIKE @sn2';r.input('sn2',sql.NVarChar,'%'+sender+'%');}
  // (جديد) بحث بالمستلم، وبفترة تاريخ التسجيل (CreatedAt - بيتسجل تلقائيًا وقت الحفظ)
  if(receiver){q+=' AND e.Receiver LIKE @rcv';r.input('rcv',sql.NVarChar,'%'+receiver+'%');}
  // (تعديل) دعم "يوم تسجيل محدد" بجانب فلتر "من/إلى" - لو اتحددوا مع بعض، النتايج بتبقى
  // نتايج المدى + نتايج اليوم مع بعض (OR)، مش شرط واحد بس. لو اتحدد اليوم لوحده من غير
  // مدى، بيشتغل لوحده عادي، ولو اتحدد مدى من غير يوم، بيشتغل المدى لوحده زي ما كان.
  if(createdFrom||createdTo||createdDay){
    const conds=[];
    if(createdFrom||createdTo){
      let rc='1=1';
      if(createdFrom){rc+=' AND e.CreatedAt>=@cf';r.input('cf',sql.Date,createdFrom);}
      if(createdTo){rc+=' AND e.CreatedAt<DATEADD(day,1,@ct)';r.input('ct',sql.Date,createdTo);}
      conds.push('('+rc+')');
    }
    if(createdDay){
      conds.push('(e.CreatedAt>=@cd AND e.CreatedAt<DATEADD(day,1,@cd))');
      r.input('cd',sql.Date,createdDay);
    }
    q+=' AND ('+conds.join(' OR ')+')';
  }
  if(important==='1'){q+=' AND e.IsImportant=1';}
  if(urgent==='1'){q+=' AND e.IsUrgent=1';}
  q+=' ORDER BY e.EventDate DESC';
  res.json((await r.query(q)).recordset);
}catch(e){res.json([]);}});

app.get('/api/events/:orgId',async(req,res)=>{try{
  const r=await(await db()).request().input('id',sql.Int,req.params.orgId).query('SELECT* FROM OrgEvents WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY EventDate DESC');
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/events',async(req,res)=>{try{
  const d=req.body;
  // (جديد) رفض قاطع - نفس رقم الوارد بنفس تاريخ الوارد ممنوع يتكرر لحدث تاني لنفس الجمعية،
  // بغض النظر عن الموضوع أو الوقت اللي بينهم. ده تكرار بيانات حقيقي (نفس الخطاب) مش مجرد
  // ضغطة زرار متكررة، فبيترفض برسالة واضحة بدل ما يتسجل بصمت.
  {
    const incDup=await checkIncomingNumDuplicate(await db(),{orgId:d.OrgID,inNum:d.IncomingNum,inDate:d.IncomingDate});
    if(incDup) return res.status(409).json({error:`رقم الوارد (${d.IncomingNum}) بتاريخ (${d.IncomingDate}) مسجَّل بالفعل لحدث آخر لنفس الجمعية${incDup.Subject?' - الموضوع: '+incDup.Subject:''} - لا يجوز تسجيله مرة أخرى`});
    const outDup=await checkOutgoingNumDuplicate(await db(),{orgId:d.OrgID,actions:d.Actions});
    if(outDup) return res.status(409).json({error:`رقم الصادر (${outDup.outNum}) بتاريخ (${outDup.outDate}) مسجَّل بالفعل ضمن إجراءات حدث آخر لنفس الجمعية${outDup.Subject?' - الموضوع: '+outDup.Subject:''} - لا يجوز تسجيله مرة أخرى`});
  }
  // (جديد) حماية من التسجيل المكرر بسبب ضغط "حفظ الحدث" أكثر من مرة بسرعة (دبل كليك، أو
  // إعادة محاولة بسبب رسالة تنبيه ظهرت واتفهمت غلط إنها فشل) - نفس الجمعية + نفس النوع +
  // نفس الموضوع + نفس الإدارة + نفس تاريخ الحدث، لو اتسجلت فعلاً خلال آخر 20 ثانية، نعتبرها
  // نفس الضغطة القديمة ونرجّع نفس السجل الموجود بدل ما نكرره في قاعدة البيانات.
  // ملحوظة مهمة: ده مايمنعش خالص تسجيل حدث جديد فعلي على نفس الجمعية بعد كده - أي اختلاف في
  // النوع/الموضوع/التاريخ، أو حتى نفس البيانات بالظبط بعد مرور أكتر من 20 ثانية، بيتسجّل عادي
  // كحدث مستقل من غير أي قيد إضافي (العدد اللي بيتسجل لكل جمعية مالوش أي حد أقصى).
  const dupChk=await(await db()).request()
    .input('oid',sql.Int,d.OrgID).input('et',sql.NVarChar,d.EventType||'')
    .input('sb',sql.NVarChar,d.Subject||'').input('dp',sql.NVarChar,d.Department||'')
    .input('ed3',sql.Date,d.EventDate)
    .query(`SELECT TOP 1 EventID FROM OrgEvents
      WHERE OrgID=@oid AND ISNULL(EventType,N'')=@et AND ISNULL(Subject,N'')=@sb
        AND ISNULL(Department,N'')=@dp AND EventDate=@ed3
        AND ISNULL(IsDeleted,0)=0 AND CreatedAt>=DATEADD(SECOND,-20,GETDATE())
      ORDER BY EventID DESC`);
  if(dupChk.recordset.length){
    return res.json({ok:true, EventID:dupChk.recordset[0].EventID});
  }
  await(await db()).request().input('oid',sql.Int,d.OrgID).input('et',sql.NVarChar,d.EventType)
    .input('sb',sql.NVarChar,d.Subject).input('ed2',sql.Date,d.EventDate)
    .input('dp',sql.NVarChar,d.Department).input('by',sql.Int,d.RecordedBy)
    .input('in',sql.NVarChar,d.IncomingNum||null).input('ind',sql.Date,d.IncomingDate||null)
    .input('rv',sql.NVarChar,d.Receiver||null).input('ac',sql.NVarChar,d.Actions?JSON.stringify(d.Actions):null)
    .input('st',sql.NVarChar,d.Status||'جاري العمل')
    .input('imp',sql.Bit,d.IsImportant?1:0).input('urg',sql.Bit,d.IsUrgent?1:0)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .input('sn',sql.NVarChar,d.SenderName||null)
    .query(`INSERT INTO OrgEvents(OrgID,EventType,Subject,EventDate,Department,RecordedBy,
      IncomingNum,IncomingDate,Receiver,Actions,Status,IsImportant,IsUrgent,FilePath,SenderName)
      VALUES(@oid,@et,@sb,@ed2,@dp,@by,@in,@ind,@rv,@ac,@st,@imp,@urg,@fp,@sn)`);
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ تعديل حدث جمعية (لتصحيح رقم/تاريخ الوارد أو أي بيان آخر بعد التسجيل) ══
// ملحوظة أمان: التعديل مقصور على (١) المدير العام، أو (٢) نفس الموظف اللي سجّل
// الحدث أصلاً (RecordedBy) وهو لسه تابع لنفس الإدارة المختصة بالحدث ومعه صلاحية "تعديل".
// أي طلب من مستخدم تاني (حتى لو من نفس الإدارة) بيترفض برسالة 403 واضحة.
app.put('/api/events/:id',async(req,res)=>{try{
  const d=req.body;
  const database=await db();
  const evR=await database.request().input('id',sql.Int,req.params.id)
    .query('SELECT EventID,OrgID,RecordedBy,Department FROM OrgEvents WHERE EventID=@id');
  if(!evR.recordset.length) return res.status(404).json({error:'الحدث غير موجود'});
  const ev=evR.recordset[0];

  const reqId=d.RequesterID!=null?parseInt(d.RequesterID):null;
  const reqDept=d.RequesterDept||null;
  const reqAction=d.RequesterAction||null;
  const reqRole=d.RequesterRole||null;
  const isAdmin = reqRole==='admin' || reqAction==='admin';
  const isOwnerWithPermission = reqId!=null && ev.RecordedBy!=null && reqId===ev.RecordedBy
    && reqDept && reqDept===ev.Department && reqAction==='edit';
  if(!isAdmin && !isOwnerWithPermission){
    return res.status(403).json({error:'غير مسموح - التعديل مقصور على من قام بتسجيل هذا الحدث من الإدارة المختصة وله صلاحية تعديل'});
  }

  // (جديد) نفس فحص تكرار رقم الوارد/رقم الصادر المطبَّق عند التسجيل الأول - هنا بنستثني
  // الحدث الحالي نفسه من الفحص (عشان تقدري تحفظي تعديل عادي على نفس الحدث من غير ما يترفض
  // باعتباره "متعارض مع نفسه")، وبنقارن بس مع بقية أحداث نفس الجمعية.
  {
    const incDup=await checkIncomingNumDuplicate(database,{orgId:ev.OrgID,inNum:d.IncomingNum,inDate:d.IncomingDate,excludeEventId:ev.EventID});
    if(incDup) return res.status(409).json({error:`رقم الوارد (${d.IncomingNum}) بتاريخ (${d.IncomingDate}) مسجَّل بالفعل لحدث آخر لنفس الجمعية${incDup.Subject?' - الموضوع: '+incDup.Subject:''} - لا يجوز تسجيله مرة أخرى`});
    const outDup=await checkOutgoingNumDuplicate(database,{orgId:ev.OrgID,actions:d.Actions,excludeEventId:ev.EventID});
    if(outDup) return res.status(409).json({error:`رقم الصادر (${outDup.outNum}) بتاريخ (${outDup.outDate}) مسجَّل بالفعل ضمن إجراءات حدث آخر لنفس الجمعية${outDup.Subject?' - الموضوع: '+outDup.Subject:''} - لا يجوز تسجيله مرة أخرى`});
  }

  const r=await database.request().input('id',sql.Int,req.params.id)
    .input('et',sql.NVarChar,d.EventType||null).input('sb',sql.NVarChar,d.Subject||null)
    .input('dp',sql.NVarChar,d.Department||null)
    .input('in',sql.NVarChar,d.IncomingNum||null).input('ind',sql.Date,d.IncomingDate||null)
    .input('rv',sql.NVarChar,d.Receiver||null).input('st',sql.NVarChar,d.Status||'جاري العمل')
    .input('imp',sql.Bit,d.IsImportant?1:0).input('urg',sql.Bit,d.IsUrgent?1:0)
    .input('ac',sql.NVarChar,d.Actions?JSON.stringify(d.Actions):null)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .input('ed2',sql.Date,d.EventDate||null)
    // (جديد) الجهة المرسلة قابلة للتعديل هنا لأحداث الجمعيات (على عكس أحداث "الجهات الأخرى"
    // اللي المرسل فيها ثابت عمداً) - لو محصلش إرسال قيمة، بنحافظ على القيمة الحالية بدل مسحها
    .input('sn',sql.NVarChar,(d.SenderName!=null?d.SenderName:null))
    .query(`UPDATE OrgEvents SET EventType=@et,Subject=@sb,Department=@dp,
      IncomingNum=@in,IncomingDate=@ind,Receiver=@rv,Status=@st,IsImportant=@imp,IsUrgent=@urg,
      Actions=@ac,FilePath=@fp
      ${d.SenderName!=null?',SenderName=@sn':''}
      ${d.EventDate?',EventDate=@ed2':''}
      WHERE EventID=@id`);
  if(r.rowsAffected[0]===0) return res.status(404).json({error:'الحدث غير موجود'});
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ (جديد) إضافة إجراء على وارد موجود - موظف الإدارة المختصة بالحدث (Department) أو المدير ══
// مؤقتًا: الصلاحية = نفس إدارة الحدث + صلاحية "edit". مابتعدّلش أي بيانات للوارد نفسه (رقم/تاريخ/موضوع/نوع/مرسل/مستلم)،
// بتعدّل بس: الإجراءات، الحالة، هام/عاجل، المستند. فحص تكرار رقم الصادر شغال زي PUT /api/events/:id بالظبط.
app.put('/api/events/:id/action',async(req,res)=>{try{
  const d=req.body||{};
  const database=await db();
  const evR=await database.request().input('id',sql.Int,req.params.id)
    .query('SELECT EventID,OrgID,Department FROM OrgEvents WHERE EventID=@id AND ISNULL(IsDeleted,0)=0');
  if(!evR.recordset.length) return res.status(404).json({error:'الحدث غير موجود'});
  const ev=evR.recordset[0];
  const isAdmin = d.RequesterRole==='admin' || d.RequesterAction==='admin';
  const sameDept = d.RequesterDept && d.RequesterDept===ev.Department && d.RequesterAction==='edit';
  if(!isAdmin && !sameDept) return res.status(403).json({error:'غير مسموح - إضافة الإجراء مقصورة على موظفي الإدارة المختصة بهذا الحدث'});
  const outDup=await checkOutgoingNumDuplicate(database,{orgId:ev.OrgID,actions:d.Actions,excludeEventId:ev.EventID});
  if(outDup) return res.status(409).json({error:`رقم الصادر (${outDup.outNum}) بتاريخ (${outDup.outDate}) مسجَّل بالفعل ضمن إجراءات حدث آخر لنفس الجمعية - لا يجوز تسجيله مرة أخرى`});
  await database.request().input('id',sql.Int,req.params.id)
    .input('st',sql.NVarChar,d.Status||'جاري العمل')
    .input('imp',sql.Bit,d.IsImportant?1:0).input('urg',sql.Bit,d.IsUrgent?1:0)
    .input('ac',sql.NVarChar,d.Actions?JSON.stringify(d.Actions):null)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .query('UPDATE OrgEvents SET Status=@st,IsImportant=@imp,IsUrgent=@urg,Actions=@ac,FilePath=@fp WHERE EventID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ── حذف سجل "آخر حدث" بسبب - نفس قاعدة التعديل بالظبط (المدير، أو مين سجّله وعنده صلاحية إدارته) ──
app.delete('/api/events/:id',async(req,res)=>{try{
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const permChk=await assertCanManageDeptRecord(req.user,'OrgEvents','EventID',parseInt(req.params.id));
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  await(await db()).request().input('id',sql.Int,parseInt(req.params.id)).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE OrgEvents SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE EventID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ تحويل حدث جمعية إلى حدث "جهة أخرى" ══
// بيُستخدم لما حدث اتسجَّل بالغلط مربوط بجمعية فعلية (OrgEvents)، والمفروض يبقى حدث مستقل
// من غير أي ربط بأي جمعية (زي أحداث "الجهات الأخرى" العادية). العملية: (1) بننسخ كل بيانات
// الحدث (الموضوع/النوع/الإدارة/الإجراءات/الوارد/الحالة/المستند...) لسجل جديد في جدول
// OtherPartyEvents باسم جهة مرسلة جديد (بيُحدَّده مين بيعمل التحويل)، (2) وبعدين نمسح
// (Soft Delete - نفس أسلوب الحذف العادي، قابل للتتبع وليس محو فعلي من القرص) السجل الأصلي
// من OrgEvents، فيختفي تمامًا من سجل أحداث الجمعية دي ويظهر بدل منه كحدث "جهة أخرى" مستقل.
// ملحوظة أمان: نفس قاعدة صلاحية التعديل/الحذف بالظبط (مدير عام، أو مين سجّل الحدث وهو لسه
// تابع لنفس الإدارة ومعه صلاحية "تعديل") - مكتوبة هنا مباشرة (مش عن طريق
// assertCanManageDeptRecord) لأن الدالة دي بتفترض عمود CreatedBy في الجدول وهو مش موجود
// فعليًا في OrgEvents، فكانت هتفشل بصمت وتسمح للجميع بالخطأ - هنا بنتحقق من RecordedBy
// مباشرة زي بالظبط في PUT /api/events/:id اللي فوق (منطق مُختبَر وشغال فعليًا).
app.post('/api/events/:id/convert-to-other-party',async(req,res)=>{try{
  const id=parseInt(req.params.id);
  if(!id||isNaN(id)) return res.status(400).json({error:'معرّف الحدث غير صحيح'});
  const senderName=(req.body&&req.body.SenderName||'').trim();
  if(!senderName) return res.status(400).json({error:'اسم الجهة المرسلة إجباري لإتمام التحويل'});
  const database=await db();
  const evR=await database.request().input('id',sql.Int,id)
    .query(`SELECT e.*,u.FullName AS RecordedByName FROM OrgEvents e LEFT JOIN Users u ON e.RecordedBy=u.UserID
      WHERE e.EventID=@id AND ISNULL(e.IsDeleted,0)=0`);
  if(!evR.recordset.length) return res.status(404).json({error:'الحدث غير موجود أو محذوف بالفعل'});
  const ev=evR.recordset[0];

  const isAdmin = req.user && (req.user.action==='admin' || req.user.dept==='كل الإدارات');
  const isOwnerWithPermission = req.user && req.user.id!=null && ev.RecordedBy!=null
    && Number(req.user.id)===Number(ev.RecordedBy) && req.user.dept===ev.Department && req.user.action==='edit';
  if(!isAdmin && !isOwnerWithPermission){
    return res.status(403).json({error:'غير مسموح - التحويل مقصور على من قام بتسجيل هذا الحدث من الإدارة المختصة وله صلاحية تعديل، أو المدير العام'});
  }

  await database.request()
    .input('sn',sql.NVarChar,senderName)
    .input('in',sql.NVarChar,ev.IncomingNum||null).input('ind',sql.Date,ev.IncomingDate||null)
    .input('et',sql.NVarChar,ev.EventType||null).input('sb',sql.NVarChar,ev.Subject||null)
    .input('rv',sql.NVarChar,ev.Receiver||null).input('dp',sql.NVarChar,ev.Department||null)
    .input('st',sql.NVarChar,ev.Status||'جاري العمل').input('ac',sql.NVarChar,ev.Actions||null)
    .input('by',sql.NVarChar,ev.RecordedByName||null).input('rd',sql.NVarChar,ev.Department||null)
    .input('imp',sql.Bit,ev.IsImportant?1:0).input('urg',sql.Bit,ev.IsUrgent?1:0)
    .input('fp',sql.NVarChar,ev.FilePath||null)
    .query(`INSERT INTO OtherPartyEvents(SenderName,IncomingNum,IncomingDate,EventType,Subject,Receiver,
      Department,Status,Actions,RecordedBy,RecordedDept,IsImportant,IsUrgent,FilePath)
      VALUES(@sn,@in,@ind,@et,@sb,@rv,@dp,@st,@ac,@by,@rd,@imp,@urg,@fp)`);

  await database.request().input('id',sql.Int,id)
    .input('rs',sql.NVarChar,'تم تحويله إلى حدث "جهة أخرى" بواسطة: '+(req.user?.name||req.user?.id||'—'))
    .input('by2',sql.Int,req.user?.id||null)
    .query('UPDATE OrgEvents SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by2,DeletedAt=GETDATE() WHERE EventID=@id');

  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ADD REQUEST & DOCUMENTS
app.post('/api/add-request',async(req,res)=>{try{
  const d=req.body;
  const docPath=(d.Documents&&d.Documents.length)?d.Documents.map(x=>x.filePath).join(','):null;
  // (إصلاح) سنة القيد اللي بيكتبها مقدّم الطلب كانت بتتقرا في الواجهة بس ما كانتش بتتبعت
  // ولا بتتحفظ هنا خالص - فكانت بتضيع تمامًا، وبعدين شاشة المراجعة/القبول كانت بتفترض
  // دايمًا "السنة الحالية" كبديل لأنها ملقتش أي قيمة محفوظة. دلوقتي بتتحفظ زي ما هي.
  const regYear=parseInt(d.RegYear)||null;
  await(await db()).request().input('nm',sql.NVarChar,d.OrgName).input('tp',sql.NVarChar,d.OrgType)
    .input('rn',sql.NVarChar,d.RegNum).input('ry',sql.Int,regYear).input('gv',sql.NVarChar,d.Governorate)
    .input('ad',sql.NVarChar,d.Address).input('wf',sql.NVarChar,d.WorkField||null)
    .input('ch',sql.NVarChar,d.Chairman||null).input('ph',sql.NVarChar,d.Phone||null)
    .input('dp',sql.NVarChar,d.Department||null).input('adm',sql.NVarChar,d.AdminData||null)
    .input('doc',sql.NVarChar,docPath).input('by',sql.Int,d.RequestedBy)
    .query(`INSERT INTO AddRequests(OrgName,OrgType,RegNum,RegYear,Governorate,Address,WorkField,Chairman,Phone,Department,AdminData,DocFilePath,RequestedBy)
      VALUES(@nm,@tp,@rn,@ry,@gv,@ad,@wf,@ch,@ph,@dp,@adm,@doc,@by)`);
  res.json({ok:true});
}catch(e){
  if(e.message.includes('Invalid column name')){
    try{
      await(await db()).request().query(`IF COL_LENGTH('AddRequests','RegYear') IS NULL ALTER TABLE AddRequests ADD RegYear INT NULL;`);
      res.status(503).json({error:'تم تحديث قاعدة البيانات - أعد إرسال الطلب مرة أخرى'});
    }catch(e2){res.status(500).json({error:e2.message});}
  } else res.status(500).json({error:e.message});
}});

// افتراضيًا بيرجّع بس المستندات "الحالية" (اللي لسه ما اتبدلتش IsReplaced=0) - عشان صفحة
// "رفع/تبديل المستندات" وخطوة "المستندات الحالية" في تسجيل آخر حدث تعرض آخر نسخة بس لكل نوع.
// لو محتاجة كل تاريخ المستندات (القديم والمستبدل) ابعتي ?all=1
app.get('/api/documents/:orgId',async(req,res)=>{try{
  const oid=parseInt(req.params.orgId);
  if(!oid) return res.status(400).json({error:'رقم الجمعية غير صحيح'});
  const includeReplaced=req.query.all==='1';
  const r=await(await db()).request().input('id',sql.Int,oid)
    .query(`SELECT* FROM Documents WHERE OrgID=@id ${includeReplaced?'':'AND (IsReplaced=0 OR IsReplaced IS NULL)'} ORDER BY UploadedAt DESC`);
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════════════════════
// (جديد) رفع/تبديل مستند فعليًا لجمعية موجودة بالفعل في قاعدة البيانات -
// ده الإصلاح الجذري لمشكلة "المستند اللي بيترفع من صفحة 📎 رفع/تبديل المستندات
// وخطوة 📎 المستندات الحالية (تسجيل آخر حدث) مكانش بيتسجل فعليًا في قاعدة البيانات،
// فمكانش بيظهر في أي استمارة أو تقرير بعد كده، وكمان مكانش ممكن تعديل/استبدال أي
// مستند اترفع فعلاً من قبل". دلوقتي: أي رفع بيتسجل كصف حقيقي في جدول Documents
// مربوط بالـOrgID، ولو كان فيه مستند سابق من نفس النوع لنفس الجمعية بيتعلّم
// IsReplaced=1 (بدل الحذف، عشان يفضل موجود كتاريخ) والمستند الجديد هو اللي
// بيظهر كـ"الحالي" في كل مكان (GET /api/documents/:orgId العادي).
// يتطلب تسجيل دخول (requireAuth) لأنه إجراء يعدّل بيانات جمعية حقيقية.
app.post('/api/documents',requireAuth,async(req,res)=>{try{
  const{OrgID,DocType,FilePath,DocName}=req.body;
  const oid=parseInt(OrgID);
  if(!oid) return res.status(400).json({error:'رقم الجمعية مطلوب'});
  if(!FilePath) return res.status(400).json({error:'مسار الملف مطلوب - ارفعي الملف أولاً'});
  const d=await db();
  const orgChk=await d.request().input('id',sql.Int,oid).query('SELECT OrgID FROM Organizations WHERE OrgID=@id');
  if(!orgChk.recordset.length) return res.status(404).json({error:'الجمعية غير موجودة'});
  if(DocType){
    await d.request().input('id',sql.Int,oid).input('dt',sql.NVarChar,DocType)
      .query(`UPDATE Documents SET IsReplaced=1,ReplacedAt=GETDATE() WHERE OrgID=@id AND DocType=@dt AND (IsReplaced=0 OR IsReplaced IS NULL)`);
  }
  const ins=await d.request().input('oid',sql.Int,oid).input('dt',sql.NVarChar,DocType||null)
    .input('dn',sql.NVarChar,DocName||null).input('fp',sql.NVarChar,FilePath).input('by',sql.Int,req.user.id)
    .query('INSERT INTO Documents(OrgID,DocType,DocName,FilePath,UploadedBy) OUTPUT INSERTED.* VALUES(@oid,@dt,@dn,@fp,@by)');
  res.json({ok:true,doc:ins.recordset[0]});
}catch(e){res.status(500).json({error:e.message});}});

// ══ إحصاء القيد ══
app.get('/api/stats/qaid',async(req,res)=>{try{
  const{gov,type,level,status,fromDate,toDate}=req.query;
  const d=await db();const r=d.request();
  let where=' WHERE IsActive=1';
  if(gov){where+=' AND Governorate=@gv';r.input('gv',sql.NVarChar,gov);}
  if(type){where+=' AND OrgType=@tp';r.input('tp',sql.NVarChar,type);}
  if(level){where+=' AND Level=@lv';r.input('lv',sql.NVarChar,level);}
  if(status){where+=' AND Status=@st';r.input('st',sql.NVarChar,status);}
  // ── السجلات القديمة المستوردة بالجملة (بدون RegDate موثّق) بتفضل مستثناة من أي فترة دقيقة
  // (شهر/أسبوع) تفاديًا لأي تقدير وهمي، بس لو الفترة المطلوبة سنة كاملة بالظبط (1 يناير - 31 ديسمبر
  // لنفس السنة) بنسمح كمان بمطابقة RegYear للسجلات اللي مالهاش RegDate، لأن سنة القيد بيانها موثوقة
  // ومعروفة لكل السجلات، فمفيش داعي نستبعدها من تقرير سنوي بينما هي فعلاً بتنتمي للسنة دي.
  let fdParsed=fromDate?new Date(fromDate):null, tdParsed=toDate?new Date(toDate):null;
  const isFullYear = fdParsed&&tdParsed&&fromDate.endsWith('-01-01')&&toDate.endsWith('-12-31')&&fdParsed.getFullYear()===tdParsed.getFullYear();
  if(fromDate){
    if(isFullYear){ where+=' AND (RegDate>=@fd OR (RegDate IS NULL AND RegYear=@ry))'; r.input('fd',sql.Date,fromDate); r.input('ry',sql.Int,fdParsed.getFullYear()); }
    else { where+=' AND RegDate>=@fd'; r.input('fd',sql.Date,fromDate); }
  }
  if(toDate && !isFullYear){where+=' AND RegDate<=@td';r.input('td',sql.Date,toDate);}
  else if(toDate && isFullYear){where+=' AND (RegDate<=@td OR RegDate IS NULL)';r.input('td',sql.Date,toDate);}
  const q=`SELECT 
    COUNT(*) AS Total,
    SUM(CASE WHEN OrgType=N'جمعية' THEN 1 ELSE 0 END) AS Societies,
    SUM(CASE WHEN OrgType=N'مؤسسة' THEN 1 ELSE 0 END) AS Foundations,
    SUM(CASE WHEN OrgType=N'اتحاد' THEN 1 ELSE 0 END) AS Unions,
    SUM(CASE WHEN Level=N'مركزي' THEN 1 ELSE 0 END) AS Central,
    SUM(CASE WHEN Level=N'مديرية' THEN 1 ELSE 0 END) AS Directorate,
    SUM(CASE WHEN LevelChangeNote LIKE N'%محلية%' THEN 1 ELSE 0 END) AS ToDir,
    SUM(CASE WHEN LevelChangeNote LIKE N'%مركزية من%' THEN 1 ELSE 0 END) AS FromDir,
    SUM(CASE WHEN Status=N'نشطة' THEN 1 ELSE 0 END) AS Active,
    SUM(CASE WHEN Status=N'منحلة' THEN 1 ELSE 0 END) AS Dissolved,
    SUM(CASE WHEN Status=N'موقوفة' THEN 1 ELSE 0 END) AS Suspended,
    SUM(CASE WHEN Status=N'تحت التأسيس' THEN 1 ELSE 0 END) AS UnderFormation,
    SUM(CASE WHEN RegDate IS NULL THEN 1 ELSE 0 END) AS NoRegDate
    FROM Organizations ${where}`;
  let result;
  try{ result=await r.query(q); }
  catch(e){
    if(e.message.includes('Invalid column name')){
      await d.request().query(`IF COL_LENGTH('Organizations','LevelChangeNote') IS NULL ALTER TABLE Organizations ADD LevelChangeNote NVARCHAR(500) NULL;`);
      result=await r.query(q);
    } else throw e;
  }
  // ── إحصاء حسب المحافظة مضمَّن مباشرة في نفس تقرير القيد (وليس منفرداً وحده) ──
  let byGovernorate=[];
  try{
    const rg=d.request();
    if(type)rg.input('tp',sql.NVarChar,type);
    if(level)rg.input('lv',sql.NVarChar,level);
    if(status)rg.input('st',sql.NVarChar,status);
    let gwhere=' WHERE IsActive=1 AND Governorate IS NOT NULL';
    if(type)gwhere+=' AND OrgType=@tp';
    if(level)gwhere+=' AND Level=@lv';
    if(status)gwhere+=' AND Status=@st';
    if(fromDate){
      if(isFullYear){ gwhere+=' AND (RegDate>=@fd OR (RegDate IS NULL AND RegYear=@ry))'; rg.input('fd',sql.Date,fromDate); rg.input('ry',sql.Int,fdParsed.getFullYear()); }
      else { gwhere+=' AND RegDate>=@fd'; rg.input('fd',sql.Date,fromDate); }
    }
    if(toDate){
      if(isFullYear){ gwhere+=' AND (RegDate<=@td OR RegDate IS NULL)'; rg.input('td',sql.Date,toDate); }
      else { gwhere+=' AND RegDate<=@td'; rg.input('td',sql.Date,toDate); }
    }
    byGovernorate=(await rg.query(`SELECT Governorate, COUNT(*) AS Count FROM Organizations ${gwhere} GROUP BY Governorate ORDER BY Count DESC`)).recordset;
  }catch(e){/* تجاهل - الإحصاء الأساسي أهم */}
  // ── (إصلاح) الرد كان بيرجّع أرقام مجمّعة بس من غير قائمة الجمعيات نفسها، فكان زرار "تصدير
  // Excel" في شاشة إحصاء القيد بيفشل بصمت (d.list غير معرّف). بنرجّع هنا نفس الجمعيات المطابقة
  // لفلاتر الإحصاء بكل أعمدتها كاملة عشان تصدير الإكسيل يشتغل ويحتوي كل البيانات ──
  let list=[];
  try{
    const rl=d.request();
    if(type)rl.input('tp',sql.NVarChar,type);
    if(level)rl.input('lv',sql.NVarChar,level);
    if(status)rl.input('st',sql.NVarChar,status);
    if(gov)rl.input('gv',sql.NVarChar,gov);
    if(fromDate){
      if(isFullYear){ rl.input('fd',sql.Date,fromDate); rl.input('ry',sql.Int,fdParsed.getFullYear()); }
      else { rl.input('fd',sql.Date,fromDate); }
    }
    if(toDate){ rl.input('td',sql.Date,toDate); }
    list=(await rl.query(`SELECT OrgID,OrgName,OrgType,RegNum,RegYear,UnifiedNumber,Level,Address,Governorate,
      Directorate,Chairman,Phone,WorkField,PublicBenefit,PublicBenefitDecree,PublicBenefitYear,Status,
      NameChanged,PreviousName,PreviousGov,NameChangeDate,PrevRegNum,PrevRegYear,PrevGovTransfer,TransferDate,
      NewRegNum,NewRegYear,NewGovTransfer,Notes,CreatedAt
      FROM Organizations ${where} ORDER BY RegNum`)).recordset;
  }catch(e){/* تجاهل - الإحصاء الأساسي أهم */}
  res.json({...result.recordset[0],byGovernorate,list});
}catch(e){res.status(500).json({error:e.message});}});

// ══ إحصاء بواسطة ══
app.get('/api/stats/by-user',async(req,res)=>{try{
  const{dept,fromDate,toDate}=req.query;
  const d=await db();const r=d.request();
  let q=`SELECT u.FullName,u.Department,COUNT(*) AS EventCount,
    MAX(e.EventDate) AS LastEvent
    FROM OrgEvents e
    JOIN Users u ON e.RecordedBy=u.UserID
    WHERE 1=1`;
  if(dept){q+=' AND u.Department=@dp';r.input('dp',sql.NVarChar,dept);}
  if(fromDate){q+=' AND e.EventDate>=@fd';r.input('fd',sql.Date,fromDate);}
  if(toDate){q+=' AND e.EventDate<=@td';r.input('td',sql.Date,toDate);}
  q+=' GROUP BY u.FullName,u.Department ORDER BY EventCount DESC';
  res.json((await r.query(q)).recordset);
}catch(e){res.status(500).json({error:e.message});}});

// ══ قبول/رفض طلبات تسجيل الدخول (مع حد أقصى/صفحات حتى لا تتراكم الطلبات) ══
app.get('/api/registration-requests',async(req,res)=>{try{
  const{status}=req.query;
  const limit=Math.min(parseInt(req.query.limit)||50,200);
  const offset=parseInt(req.query.offset)||0;
  const d=await db();const r=d.request().input('lim',sql.Int,limit).input('off',sql.Int,offset);
  let where='WHERE 1=1';
  if(status){where+=' AND Status=@st';r.input('st',sql.NVarChar,status);}
  const list=await r.query(`SELECT* FROM RegistrationRequests ${where} ORDER BY CreatedAt DESC OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`);
  const cnt=await d.request().query(`SELECT
    SUM(CASE WHEN Status=N'pending' THEN 1 ELSE 0 END) AS Pending,
    SUM(CASE WHEN Status=N'approved' THEN 1 ELSE 0 END) AS Approved,
    SUM(CASE WHEN Status=N'rejected' THEN 1 ELSE 0 END) AS Rejected,
    COUNT(*) AS Total FROM RegistrationRequests`);
  res.json({list:list.recordset,counts:cnt.recordset[0],limit,offset});
}catch(e){res.status(500).json({error:e.message});}});

app.put('/api/registration-requests/:id',async(req,res)=>{try{
  const{status,department,permission,pin}=req.body;
  const d=await db();
  if(status==='approved'){
    // جلب بيانات الطلب
    const req2=await d.request().input('id',sql.Int,req.params.id)
      .query('SELECT* FROM RegistrationRequests WHERE ReqID=@id');
    if(!req2.recordset.length)return res.status(404).json({error:'طلب غير موجود'});
    const rr=req2.recordset[0];
    // إنشاء المستخدم - يتم تشفير PIN فورًا (bcrypt) ولا يُخزَّن أي نص صريح في القاعدة
    const hashedPin=await hashPin(pin||'1234');
    await d.request()
      .input('nm',sql.NVarChar,rr.FullName)
      .input('ni',sql.NVarChar,rr.NationalID)
      .input('dp',sql.NVarChar,department||rr.Department)
      .input('pm',sql.NVarChar,permission||rr.Permission)
      .input('ph',sql.NVarChar,hashedPin)
      .query('INSERT INTO Users(FullName,NationalID,Department,Permission,PasswordHash,IsApproved,IsActive) VALUES(@nm,@ni,@dp,@pm,@ph,1,1)');
  }
  await d.request().input('id',sql.Int,req.params.id).input('st',sql.NVarChar,status)
    .query('UPDATE RegistrationRequests SET Status=@st WHERE ReqID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ تعديل مستخدم ══
// PIN اختياري هنا: لو الأدمن بعتها (يعني بيغيّر كلمة المرور) بتتشفّر بـ bcrypt قبل التخزين،
// ولو مبعتهاش، كلمة المرور الحالية تفضل زي ما هي (من غير أي لمس لـ PasswordHash).
app.put('/api/users/:id',async(req,res)=>{try{
  const{FullName,Department,Permission,PIN,IsActive}=req.body;
  const d=await db();
  const r=d.request().input('id',sql.Int,req.params.id)
    .input('nm',sql.NVarChar,FullName).input('dp',sql.NVarChar,Department)
    .input('pm',sql.NVarChar,Permission).input('ia',sql.Bit,IsActive?1:0);
  let setPinSql='';
  if(PIN && String(PIN).trim()){
    const hashedPin=await hashPin(String(PIN).trim());
    r.input('ph',sql.NVarChar,hashedPin);
    setPinSql=',PasswordHash=@ph,PIN=NULL';
  }
  await r.query(`UPDATE Users SET FullName=@nm,Department=@dp,Permission=@pm,IsActive=@ia${setPinSql} WHERE UserID=@id`);
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

console.log('✅ All API endpoints loaded');

// ══ طلبات إضافة جمعية - GET و PUT (مع حد أقصى/صفحات حتى لا تتراكم الطلبات) ══
app.get('/api/add-requests',async(req,res)=>{try{
  const{status,mine}=req.query;
  const limit=Math.min(parseInt(req.query.limit)||50,200);
  const offset=parseInt(req.query.offset)||0;
  const d=await db();const r=d.request().input('lim',sql.Int,limit).input('off',sql.Int,offset);
  let where='WHERE 1=1';
  // ── (جديد) mine=1: تُستخدم في شاشة "طلباتي" (صاحب الطلب فقط) - نتجاهل تمامًا أي RequestedBy
  //    يُرسَل من العميل ونعتمد فقط على هوية المستخدم من التوكن نفسه (req.user.id) حتى لا يقدر
  //    أي مستخدم يطّلع على طلبات غيره بتمرير رقم مستخدم آخر ══
  if(mine==='1'){
    if(!req.user||!req.user.id) return res.status(401).json({error:'يجب تسجيل الدخول'});
    where+=' AND RequestedBy=@rb';r.input('rb',sql.Int,req.user.id);
  }
  if(status){where+=' AND Status=@st';r.input('st',sql.NVarChar,status);}
  const list=await r.query(`SELECT* FROM AddRequests ${where} ORDER BY CreatedAt DESC OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`);
  let cntWhere='WHERE 1=1', cntReq=d.request();
  if(mine==='1'){ cntWhere+=' AND RequestedBy=@rb'; cntReq.input('rb',sql.Int,req.user.id); }
  const cnt=await cntReq.query(`SELECT
    SUM(CASE WHEN Status=N'pending' THEN 1 ELSE 0 END) AS Pending,
    SUM(CASE WHEN Status=N'approved' THEN 1 ELSE 0 END) AS Approved,
    SUM(CASE WHEN Status=N'rejected' THEN 1 ELSE 0 END) AS Rejected,
    COUNT(*) AS Total FROM AddRequests ${cntWhere}`);
  res.json({list:list.recordset,counts:cnt.recordset[0],limit,offset});
}catch(e){res.status(500).json({error:e.message});}});

// عند القبول: يتم فعليًا إنشاء الجمعية في جدول Organizations (وليس فقط تغيير الحالة)
app.put('/api/add-requests/:id',async(req,res)=>{try{
  const{status,Level,RegYear,ReviewedBy,AttachToOrgID}=req.body;
  const d=await db();
  // ── (جديد) تعديل صاحب الطلب لمحتوى طلبه هو بالذات - مسار مستقل تمامًا عن مسار
  // القبول/الرفض تحت (ده بيفضل زي ما هو من غير أي لمس). لازم يتبعت editContent:true
  // صراحةً من الواجهة عشان نضمن إن مفيش أي تعارض مع نداءات القبول/الرفض القديمة.
  // مسموح فقط لصاحب الطلب نفسه (أو المدير العام)، وبس وهو لسه "قيد الانتظار" (pending) -
  // بمجرد ما يتقبل الطلب أو يترفض، مبيبقاش قابل للتعديل من هنا خالص.
  if(req.body.editContent===true){
    if(!req.user||!req.user.id) return res.status(401).json({error:'يجب تسجيل الدخول'});
    const rq=await d.request().input('id',sql.Int,req.params.id).query('SELECT* FROM AddRequests WHERE ReqID=@id');
    if(!rq.recordset.length) return res.status(404).json({error:'الطلب غير موجود'});
    const cur=rq.recordset[0];
    const isOwner=cur.RequestedBy && req.user.id===cur.RequestedBy;
    const isPrivileged=req.user.action==='admin'||req.user.dept==='كل الإدارات';
    if(!isOwner && !isPrivileged) return res.status(403).json({error:'لا تملك صلاحية تعديل هذا الطلب - هو ليس طلبك'});
    if(cur.Status!=='pending') return res.status(409).json({error:'لا يمكن تعديل طلب تم البت فيه بالفعل (مقبول/مرفوض)'});
    const b=req.body;
    // ── (جديد) لو الواجهة بعتت مفتاح Documents صراحةً (حتى لو مصفوفة فاضية) بنعتبره تحديد كامل
    // لقائمة المستندات الجديدة (يسمح بحذف كل المستندات القديمة لو المستخدم شالهم كلهم فعلاً) -
    // أما لو المفتاح مش موجود في الطلب أصلاً (تعديل مايمسّش المستندات) فبنفضل محتفظين بالقديم ──
    const docPath=Array.isArray(b.Documents)?(b.Documents.map(x=>x.filePath).filter(Boolean).join(',')||null):cur.DocFilePath;
    const mergedRegYear=parseInt(mergeField(b,cur,'RegYear'))||null;
    await d.request().input('id',sql.Int,req.params.id)
      .input('nm',sql.NVarChar,mergeField(b,cur,'OrgName')).input('tp',sql.NVarChar,mergeField(b,cur,'OrgType'))
      .input('rn',sql.NVarChar,mergeField(b,cur,'RegNum')).input('ry',sql.Int,mergedRegYear).input('gv',sql.NVarChar,mergeField(b,cur,'Governorate'))
      .input('ad',sql.NVarChar,mergeField(b,cur,'Address')).input('wf',sql.NVarChar,mergeField(b,cur,'WorkField'))
      .input('ch',sql.NVarChar,mergeField(b,cur,'Chairman')).input('ph',sql.NVarChar,mergeField(b,cur,'Phone'))
      .input('adm',sql.NVarChar,Object.prototype.hasOwnProperty.call(b,'AdminData')?b.AdminData:cur.AdminData)
      .input('doc',sql.NVarChar,docPath)
      .query(`UPDATE AddRequests SET OrgName=@nm,OrgType=@tp,RegNum=@rn,RegYear=@ry,Governorate=@gv,Address=@ad,
        WorkField=@wf,Chairman=@ch,Phone=@ph,AdminData=@adm,DocFilePath=@doc WHERE ReqID=@id`);
    return res.json({ok:true});
  }
  if(status==='approved'){
    const rq=await d.request().input('id',sql.Int,req.params.id).query('SELECT* FROM AddRequests WHERE ReqID=@id');
    if(!rq.recordset.length) return res.status(404).json({error:'الطلب غير موجود'});
    const r=rq.recordset[0];
    if(r.Status==='approved') return res.status(409).json({error:'تم قبول هذا الطلب مسبقاً'});
    let newOrgId;
    // ── لو المُراجِع اختار إن الطلب ده في الأصل بيانات حدث/بيانات إدارية لجمعية موجودة بالفعل
    //    (مش جمعية جديدة فعلاً) - بيبعت AttachToOrgID فنربط البيانات بالجمعية دي مباشرة
    //    من غير ما نعمل سجل جمعية جديد ومن غير أي فحص تكرار رقم قيد (مالوش لازمة هنا) ──
    if(AttachToOrgID){
      const existing=await d.request().input('id',sql.Int,parseInt(AttachToOrgID)).query('SELECT OrgID FROM Organizations WHERE OrgID=@id');
      if(!existing.recordset.length) return res.status(404).json({error:'الجمعية المطلوب الربط بها غير موجودة'});
      newOrgId=existing.recordset[0].OrgID;
      await d.request().input('id',sql.Int,req.params.id).input('lo',sql.Int,newOrgId)
        .query(`UPDATE AddRequests SET RequestKind='event_only',LinkedOrgID=@lo WHERE ReqID=@id`);
    } else {
    // ── (إصلاح) الافتراضي كان بيسجّل "مركزي" لأي طلب إضافة من غير ما حد يحددها فعليًا -
    // ده غلط: التسجيل المركزي المفروض يكون بس من مسار "تسجيل جمعية مركزية جديدة" المخصص
    // لإدارة القيد. أي طلب إضافة عادي (مافيهوش تحديد صريح للمستوى) يترسّجل كـ"مديرية" افتراضيًا ──
    const level=Level||'مديرية';
    // (إصلاح) لو المُراجِع ماغيّرش خانة السنة، نستخدم السنة اللي كتبها مقدّم الطلب نفسه
    // وقت التسجيل (لو كانت محفوظة) بدل ما نفترض دايمًا "السنة الحالية" على طول.
    const regYear=parseInt(RegYear)||parseInt(r.RegYear)||new Date().getFullYear();
    const regNum=parseInt(r.RegNum)||0;
    const dupRow=await checkRegNumDuplicate(d,{rn:regNum,lv:level,gv:r.Governorate});
    if(dupRow) return res.status(409).json({error:regNumDuplicateMessage(dupRow)+' - عدّلي السنة أو المستوى أو المديرية'});
    try{
      const ins=await d.request()
        .input('nm',sql.NVarChar,r.OrgName).input('tp',sql.NVarChar,r.OrgType||'جمعية')
        .input('rn',sql.Int,regNum).input('ry',sql.Int,regYear).input('lv',sql.NVarChar,level)
        .input('ad',sql.NVarChar,r.Address).input('gv',sql.NVarChar,r.Governorate)
        .input('ch',sql.NVarChar,r.Chairman).input('ph',sql.NVarChar,r.Phone)
        .input('wf',sql.NVarChar,r.WorkField).input('by',sql.Int,ReviewedBy||r.RequestedBy||null)
        .query(`INSERT INTO Organizations(OrgName,OrgType,RegNum,RegYear,Level,Address,Governorate,Chairman,Phone,WorkField,Status,CreatedBy)
          OUTPUT INSERTED.OrgID VALUES(@nm,@tp,@rn,@ry,@lv,@ad,@gv,@ch,@ph,@wf,N'تحتاج مراجعة',@by)`);
      newOrgId=ins.recordset[0].OrgID;
    }catch(e){
      // (جديد) خط دفاع أخير ضد التزامن - راجعي نفس الملحوظة في /api/organizations فوق
      if(e.number===2601||e.number===2627){
        const dupRow2=await checkRegNumDuplicate(d,{rn:regNum,lv:level,gv:r.Governorate});
        return res.status(409).json({error:(dupRow2?regNumDuplicateMessage(dupRow2):'رقم القيد هذا مسجل مسبقاً')+' - عدّلي السنة أو المستوى أو المديرية'});
      }
      throw e;
    }
    }
    if(r.DocFilePath){
      const paths=r.DocFilePath.split(',').map(x=>x.trim()).filter(Boolean);
      for(const p of paths){
        await d.request().input('oid',sql.Int,newOrgId).input('dt',sql.NVarChar,'مستند طلب الإضافة')
          .input('fp',sql.NVarChar,p).input('by',sql.Int,ReviewedBy||null)
          .query('INSERT INTO Documents(OrgID,DocType,FilePath,UploadedBy) VALUES(@oid,@dt,@fp,@by)');
      }
    }
    // ── AdminData بيحتوي على جزئين: Event (خانات "آخر حدث" العامة - بتتسجل دايمًا)
    //    و DeptData (خانات إدارة مقدّم الطلب المخصصة - ترخيص/منحة/مشروع/قرار/حظر)
    //    اللي دلوقتي بتتسجل فعليًا كسجل حقيقي في جدولها بنفس الـ OrgID الجديد، مش مجرد حدث نصي.
    //    (متوافق كمان مع طلبات قديمة كانت بتحفظ AdminData بشكل مسطّح بدون Event/DeptData) ──
    const reviewerId=ReviewedBy||r.RequestedBy||null;
    const today0=new Date().toISOString().split('T')[0];
    if(r.AdminData){
      try{
        const ad=JSON.parse(r.AdminData);
        // دعم الشكل القديم (مسطّح) والشكل الجديد (Event/DeptData)
        const ev = ad.Event || ((ad.EventType||ad.reqEv_actionType) ? ad : null);
        const dd = ad.DeptData || (ad.Kind ? ad : null);
        // ── الإدارة الحقيقية اللي بتملك كل نوع بيانات (ثابتة بحسب نوع السجل نفسه) - وليست
        // بالضرورة إدارة مقدّم الطلب (r.Department قد تكون إدارة القيد أو أي إدارة أخرى سجّلت
        // طلب الإضافة نيابة عن الجمعية). ده كان سبب باج "لا تملك صلاحية التعديل": سجلات جمع
        // المال/المنح/إلخ كانت بتتسجل بإدارة مقدّم الطلب بدل إدارتها الحقيقية، فبعدين موظف
        // الإدارة الفعلية (مثلاً جمع المال) كان يتفاجأ إنه ممنوع من تعديل سجل هو صاحبه أصلاً ──
        const DEPT_BY_KIND={license:'جمع المال',grants:'المنح',grant:'المنح',project:'المشروعات',legislation:'التشريعات',banned:'المحظورة'};
        const ddDept=(dd && DEPT_BY_KIND[dd.Kind])||r.Department||null;

        // 0) أعضاء مجلس الإدارة اللي اتلصقوا وقت تعبئة طلب الإضافة (لو موجودين) - بيتسجلوا فعليًا
        //    في جدول BoardMembers بمجرد قبول الطلب وإنشاء الجمعية الجديدة
        if(Array.isArray(ad.BoardMembers) && ad.BoardMembers.length){
          let chairmanName=null;
          for(const row of ad.BoardMembers){
            if(!row || !row.FullName || !String(row.FullName).trim()) continue;
            // (جديد) الرقم القومي بقى إجباري لكل عضو - أي صف بدون رقم قومي صحيح (14 رقم) يُتجاهل
            // بدل ما يتسجل بدون رقم قومي، حفاظًا على نفس القاعدة المطبّقة في باقي الشاشة.
            const nidValid = row.NationalID && /^\d{14}$/.test(String(row.NationalID).trim());
            if(!nidValid) continue;
            const nid=String(row.NationalID).trim();
            await d.request().input('oid',sql.Int,newOrgId).input('nm',sql.NVarChar,String(row.FullName).trim())
              .input('ni',sql.Char(14),nid).input('ps',sql.NVarChar,row.Position||null).input('ph',sql.NVarChar,row.Phone||null)
              .input('ic',sql.Bit,row.IsChairman?1:0).input('by',sql.Int,reviewerId)
              .query(`INSERT INTO BoardMembers(OrgID,FullName,NationalID,Position,Phone,IsChairman,CreatedBy)
                VALUES(@oid,@nm,@ni,@ps,@ph,@ic,@by)`);
            if(row.IsChairman) chairmanName=String(row.FullName).trim();
          }
          if(chairmanName){
            await d.request().input('oid',sql.Int,newOrgId).input('ch',sql.NVarChar,chairmanName)
              .query('UPDATE Organizations SET Chairman=@ch WHERE OrgID=@oid');
          }
        }

        // 1) خانات "آخر حدث" العامة - تُسجَّل دائمًا كحدث على الجمعية الجديدة
        if(ev && (ev.EventType||ev.reqEv_actionType) && (ev.Subject||ev.reqEv_subject||ev.FilePath)){
          await d.request().input('oid',sql.Int,newOrgId)
            .input('et',sql.NVarChar,ev.EventType||ev.reqEv_actionType)
            .input('sb',sql.NVarChar,ev.Subject||ev.reqEv_subject)
            .input('ed2',sql.Date,ev.EventDate||today0)
            .input('dp',sql.NVarChar,r.Department||null).input('by',sql.Int,reviewerId)
            .input('in',sql.NVarChar,ev.IncomingNum||null).input('ind',sql.Date,ev.IncomingDate||null)
            .input('rv',sql.NVarChar,ev.Receiver||null).input('ac',sql.NVarChar,ev.Actions?JSON.stringify(ev.Actions):null)
            .input('st',sql.NVarChar,ev.Status||'جاري العمل')
            .input('imp',sql.Bit,ev.IsImportant?1:0).input('urg',sql.Bit,ev.IsUrgent?1:0)
            .input('fp',sql.NVarChar,ev.FilePath||null)
            .query(`INSERT INTO OrgEvents(OrgID,EventType,Subject,EventDate,Department,RecordedBy,
              IncomingNum,IncomingDate,Receiver,Actions,Status,IsImportant,IsUrgent,FilePath)
              VALUES(@oid,@et,@sb,@ed2,@dp,@by,@in,@ind,@rv,@ac,@st,@imp,@urg,@fp)`);
        }

        // 2) بيانات إدارة مقدّم الطلب المخصصة - تُسجَّل كسجل حقيقي في جدولها (وليس كحدث نصي فقط)
        if(dd && dd.Kind==='license' && dd.LicenseNumber){
          // نحسب الشهر/السنة من التاريخ لو الواجهة بعتت التاريخ بس من غيرهم (زي استمارة "طلب إضافة جمعية"
          // المختصرة من قسم "تسجيل آخر حدث") - عشان التقارير الشهرية/ربع السنوية اللي بتفلتر على
          // IssueMonth/IssueYear وLiquidationMonth/LiquidationYear متضيعش أي سجل جديد بسبب القيم الفاضية دي
          // نقرأ الشهر/السنة من نص التاريخ (YYYY-MM-DD) مباشرة بدل new Date() تجنبًا لأي انزياح
          // بسبب فرق التوقيت المحلي للسيرفر عن UTC (ymParts دالة عامة معرّفة أعلى الملف)
          const issueP=ymParts(dd.IssueDate), liqP=ymParts(dd.LiquidationDate);
          // ── الأولوية دايمًا لنص التاريخ (YYYY-MM-DD) لو موجود، مش لخانات "شهر/سنة الإصدار" المنفصلة:
          // خانة <select> الشهر في واجهة "جمع المال" بترجّع قيمة افتراضية (1=يناير) حتى لو المستخدم
          // ما فتحهاش أصلًا وملى التاريخ الحقيقي بس، فلو اعتمدنا على dd.IssueMonth الأول كنا هنسجل
          // شهر غلط رغم وجود تاريخ صحيح، وهو بالظبط اللي كان بيضيع السجلات من التقارير الشهرية.
          const issueMonth=(issueP?issueP.m:null)||dd.IssueMonth||null;
          const issueYear=(issueP?issueP.y:null)||dd.IssueYear||null;
          const liqMonth=(liqP?liqP.m:null)||dd.LiquidationMonth||null;
          const liqYear=(liqP?liqP.y:null)||dd.LiquidationYear||null;
          const dup=await d.request().input('oid',sql.Int,newOrgId).input('ln',sql.NVarChar,dd.LicenseNumber)
            .input('iy',sql.Int,issueYear||null)
            .query('SELECT LicID FROM FundraisingLicenses WHERE OrgID=@oid AND LicenseNumber=@ln AND ISNULL(IssueYear,-1)=ISNULL(@iy,-1)');
          if(!dup.recordset.length){
            await d.request().input('oid',sql.Int,newOrgId).input('ln',sql.NVarChar,dd.LicenseNumber)
              .input('ls',sql.NVarChar,dd.LicenseStatus||'ساري')
              .input('id2',sql.Date,dd.IssueDate||null).input('im',sql.Int,issueMonth||null).input('iy',sql.Int,issueYear||null)
              .input('sd',sql.Date,dd.StartDate||null).input('ed',sql.Date,dd.EndDate||null)
              .input('ld',sql.Date,dd.LiquidationDate||null).input('lm',sql.Int,liqMonth||null).input('ly',sql.Int,liqYear||null)
              .input('rv',sql.Decimal(18,2),dd.Revenue||0).input('ex',sql.Decimal(18,2),dd.Expenses||0)
              // (إصلاح) نفس إصلاح NetAmount أعلى الملف - NULL بدل 0 لو مفيش قيمة يدوية فعلية
              .input('na',sql.Decimal(18,2),(dd.NetAmount!==undefined&&dd.NetAmount!==null&&dd.NetAmount!=='')?dd.NetAmount:null)
              .input('lq',sql.NVarChar,dd.LiquidationStatus||null)
              .input('cm',sql.NVarChar,dd.CollectionMethods||null).input('lp',sql.NVarChar,dd.LicensePurpose||null)
              .input('by2',sql.Int,reviewerId).input('dp2',sql.NVarChar,ddDept)
              .input('fp',sql.NVarChar,ev?.FilePath||null)
              .query(`INSERT INTO FundraisingLicenses(OrgID,LicenseNumber,LicenseStatus,IssueDate,IssueMonth,IssueYear,StartDate,EndDate,LiquidationDate,LiquidationMonth,LiquidationYear,Revenue,Expenses,NetAmount,LiquidationStatus,DataType,CollectionMethods,LicensePurpose,CreatedBy,Department,FilePath)
                VALUES(@oid,@ln,@ls,@id2,@im,@iy,@sd,@ed,@ld,@lm,@ly,@rv,@ex,@na,@lq,N'جديدة',@cm,@lp,@by2,@dp2,@fp)`);
          }
          // ملحوظة: لا نسجّل هنا حدثًا موازيًا في OrgEvents عمدًا - بيانات إدارية بحتة،
          // يجب أن تظهر فقط في البحث/الإحصاء/التعديل الإداري الخاص بجمع المال، وليس في "آخر حدث"
        } else if(dd && (dd.Kind==='grants' || dd.Kind==='grant')){
          // الشكل الجديد: منح متعددة (dd.Grants[]) - وما زلنا نساند الشكل القديم لمنحة واحدة
          const grantsList = Array.isArray(dd.Grants) ? dd.Grants
            : (dd.GrantName ? [{GrantNumber:dd.GrantNumber,GrantName:dd.GrantName,GrantType:dd.GrantType,Amount:dd.Amount,GrantYear:dd.GrantYear}] : []);
          const savedNames=[];
          for(const [gi,g] of grantsList.entries()){
            if(!g || !g.GrantName) continue;
            await d.request().input('oid',sql.Int,newOrgId).input('gnum',sql.NVarChar,g.GrantNumber||null)
              .input('gn',sql.NVarChar,g.GrantName).input('gt',sql.NVarChar,g.GrantType||null)
              .input('am',sql.Decimal(18,2),g.Amount||0).input('gy',sql.Int,g.GrantYear||new Date().getFullYear())
              .input('dp',sql.NVarChar,ddDept).input('by',sql.Int,reviewerId)
              .input('fp',sql.NVarChar,gi===0?(ev?.FilePath||null):null)
              .query('INSERT INTO Grants(OrgID,GrantNumber,GrantName,GrantType,Amount,GrantYear,Department,CreatedBy,FilePath) VALUES(@oid,@gnum,@gn,@gt,@am,@gy,@dp,@by,@fp)');
            savedNames.push(g.GrantName);
          }
          // ملحوظة: لا نسجّل هنا حدثًا موازيًا في OrgEvents عمدًا - بيانات إدارية بحتة،
          // يجب أن تظهر فقط في البحث/الإحصاء/التعديل الإداري الخاص بالمنح، وليس في "آخر حدث"
        } else if(dd && dd.Kind==='project'){
          // الشكل الجديد: أنواع مشروعات متعددة (dd.ProjectTypes[]) - وما زلنا نساند الشكل القديم بنوع واحد
          const types = Array.isArray(dd.ProjectTypes) && dd.ProjectTypes.length ? dd.ProjectTypes
            : (dd.ProjectType ? [dd.ProjectType] : ['غير محدد']);
          // الرقم التسلسلي والتاريخ يخصّان "التسجيلة" كلها، فنُلحقهما بأول نوع بس (لتفادي
          // تعارض منع التكرار لو نفس الرقم اتكرر على أكثر من صف داخل نفس التسجيلة الواحدة).
          for(let i=0;i<types.length;i++){
            const t=types[i];
            await d.request().input('oid',sql.Int,newOrgId).input('pt',sql.NVarChar,t||null)
              .input('ia',sql.Bit,dd.IsAssigned?1:0).input('ct',sql.Int,dd.Count||1)
              .input('sn',sql.NVarChar,i===0?(dd.SerialNumber||null):null).input('idt',sql.Date,i===0?(dd.IssueDate||null):null)
              .input('dp',sql.NVarChar,ddDept).input('by',sql.Int,reviewerId)
              .input('fp',sql.NVarChar,i===0?(ev?.FilePath||null):null)
              .query('INSERT INTO Projects(OrgID,ProjectType,IsAssigned,Count,SerialNumber,IssueDate,Department,CreatedBy,FilePath) VALUES(@oid,@pt,@ia,@ct,@sn,@idt,@dp,@by,@fp)');
          }
          // ملحوظة: لا نسجّل هنا حدثًا موازيًا في OrgEvents عمدًا - بيانات إدارية بحتة،
          // يجب أن تظهر فقط في البحث/الإحصاء/التعديل الإداري الخاص بالمشروعات، وليس في "آخر حدث"
        } else if(dd && dd.Kind==='legislation' && dd.DecreeType){
          // كل نوع قرار له تاريخ فعلي بيتسجَّل من الواجهة - رقم القرار بس هو اللي مقصور على "إيقاف".
          const isStop=dd.DecreeType==='إيقاف';
          await d.request().input('oid',sql.Int,newOrgId).input('dt',sql.NVarChar,dd.DecreeType)
            .input('dn',sql.NVarChar,isStop?(dd.DecreeNumber||null):null).input('ddate',sql.Date,dd.DecreeDate||null)
            .input('dp',sql.NVarChar,ddDept).input('by',sql.Int,reviewerId)
            .input('fp',sql.NVarChar,ev?.FilePath||null)
            .query('INSERT INTO Legislations(OrgID,DecreeType,DecreeNumber,DecreeDate,Department,CreatedBy,FilePath) VALUES(@oid,@dt,@dn,@ddate,@dp,@by,@fp)');
          // ملحوظة: لا نسجّل هنا حدثًا موازيًا في OrgEvents عمدًا - بيانات إدارية بحتة،
          // يجب أن تظهر فقط في البحث/الإحصاء/التعديل الإداري الخاص بالتشريعات، وليس في "آخر حدث"
        } else if(dd && dd.Kind==='orgUnits' && Array.isArray(dd.Units) && dd.Units.length){
          // منظمات متعددة تحت الجمعية الجديدة (نفس منطق /api/org-entries بالظبط، بنفس الـ OrgID الجديد)
          const today1=new Date();
          const entP1=ymParts(dd.EntryDate);
          const entryYear1=(entP1?entP1.y:null)||today1.getFullYear();
          const entryIns=await d.request().input('oid',sql.Int,newOrgId)
            .input('em',sql.Int,today1.getMonth()+1).input('ey',sql.Int,today1.getFullYear())
            .input('nt',sql.NVarChar,dd.Notes||null)
            .input('sn',sql.NVarChar,dd.SerialNumber||null).input('ed',sql.Date,dd.EntryDate||null).input('eyr',sql.Int,entryYear1)
            .input('by',sql.Int,reviewerId)
            .query(`INSERT INTO OrgGeneralEntries(OrgID,EventMonth,EventYear,Notes,SerialNumber,EntryDate,EntryYear,CreatedBy)
              OUTPUT INSERTED.OrgEntryID VALUES(@oid,@em,@ey,@nt,@sn,@ed,@eyr,@by)`);
          const entryId=entryIns.recordset[0].OrgEntryID;
          const unitNames=[];
          for(const u of dd.Units){
            const unitName=(u.UnitName||'').trim();
            if(!unitName) continue;
            const unitIns=await d.request().input('eid',sql.Int,entryId).input('nm',sql.NVarChar,unitName)
              .input('nat',sql.NVarChar,u.Nationality||null).input('pur',sql.NVarChar,u.Purpose||null)
              .input('ren',sql.Bit,u.LicenseRenewed?1:0).input('amd',sql.Bit,u.LicenseAmended?1:0)
              .query(`INSERT INTO OrgUnits(OrgEntryID,UnitName,Nationality,Purpose,LicenseRenewed,LicenseAmended)
                OUTPUT INSERTED.UnitID VALUES(@eid,@nm,@nat,@pur,@ren,@amd)`);
            const unitId=unitIns.recordset[0].UnitID;
            const activities=Array.isArray(u.Activities)?u.Activities:[];
            for(const a of activities){
              await d.request().input('uid',sql.Int,unitId).input('nm',sql.NVarChar,a)
                .query('INSERT INTO OrgUnitActivities(UnitID,ActivityName) VALUES(@uid,@nm)');
            }
            unitNames.push(unitName);
          }
          // ملحوظة: لا نسجّل هنا حدثًا موازيًا في OrgEvents عمدًا - بيانات إدارية بحتة،
          // يجب أن تظهر فقط في البحث/الإحصاء/التعديل الإداري الخاص بالمنظمات، وليس في "آخر حدث"
        } else if(dd && dd.Kind==='banned'){
          await d.request().input('oid',sql.Int,newOrgId)
            .input('fc',sql.Bit,dd.FundsConfiscated?1:0).input('ib',sql.Bit,dd.IsBanned?1:0)
            .input('is2',sql.Bit,dd.IsSuspended?1:0).input('hc',sql.Bit,dd.HasCase?1:0)
            .input('cn',sql.NVarChar,dd.CaseNumber||null)
            .input('dip',sql.Bit,dd.DissolutionInProgress?1:0).input('ds',sql.Bit,dd.DissolutionStatus?1:0)
            .input('dn',sql.NVarChar,dd.DecreeNumber||null).input('ddate',sql.Date,dd.DecreeDate||null)
            .input('dp',sql.NVarChar,ddDept).input('by',sql.Int,reviewerId)
            .input('fp',sql.NVarChar,ev?.FilePath||null)
            .query(`INSERT INTO BannedOrgs(OrgID,FundsConfiscated,IsBanned,IsSuspended,HasCase,CaseNumber,DissolutionInProgress,DissolutionStatus,DecreeNumber,DecreeDate,Department,CreatedBy,FilePath)
              VALUES(@oid,@fc,@ib,@is2,@hc,@cn,@dip,@ds,@dn,@ddate,@dp,@by,@fp)`);
          // ملحوظة: لا نسجّل هنا حدثًا موازيًا في OrgEvents عمدًا - بيانات إدارية بحتة،
          // يجب أن تظهر فقط في البحث/الإحصاء/التعديل الإداري الخاص بالمحظورة، وليس في "آخر حدث"
        } else if(dd && dd.Kind==='other' && dd.Summary){
          await d.request().input('oid',sql.Int,newOrgId).input('by',sql.Int,reviewerId)
            .input('dp',sql.NVarChar,r.Department||null).input('sb',sql.NVarChar,dd.Summary)
            .query(`INSERT INTO OrgEvents(OrgID,EventType,Subject,EventDate,Department,RecordedBy)
              VALUES(@oid,@dp,@sb,GETDATE(),@dp,@by)`);
        }
      }catch(e){/* لو AdminData مش JSON صالح أو فشل تسجيل بيانات الإدارة، تجاهل بدون ما نوقف قبول الطلب */}
    }
    await d.request().input('id',sql.Int,req.params.id).input('st',sql.NVarChar,'approved').input('rb',sql.Int,ReviewedBy||null)
      .query('UPDATE AddRequests SET Status=@st,ReviewedBy=@rb WHERE ReqID=@id');
    return res.json({ok:true,OrgID:newOrgId});
  }
  await d.request().input('id',sql.Int,req.params.id).input('st',sql.NVarChar,status)
    .query('UPDATE AddRequests SET Status=@st WHERE ReqID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ أحداث جهة أخرى ══
app.post('/api/other-party-events',async(req,res)=>{try{
  const d=req.body;
  // ══ منع التكرار: لو نفس (الاسم + رقم الوارد + تاريخ الوارد) الثلاثة مسجَّلين قبل كده
  // بالظبط لجهة أخرى، نرفض الإضافة. الثلاثة مع بعض هم شرط التكرار (مش أي واحد لوحده). ══
  if(d.sender && d.inNum && d.inDate){
    const dup=await(await db()).request()
      .input('sn',sql.NVarChar,String(d.sender).trim()).input('in',sql.NVarChar,String(d.inNum).trim()).input('id2',sql.Date,d.inDate)
      .query(`SELECT TOP 1 EventID FROM OtherPartyEvents WHERE ISNULL(IsDeleted,0)=0
        AND SenderName=@sn AND IncomingNum=@in AND IncomingDate=@id2`);
    if(dup.recordset.length) return res.status(409).json({error:`⚠️ هذا الحدث مسجَّل بالفعل من قبل - نفس الاسم "${d.sender}" ونفس رقم الوارد "${d.inNum}" ونفس التاريخ (حدث رقم ${dup.recordset[0].EventID}). لو ده حدث مختلف فعلًا، تأكدي من رقم الوارد أو التاريخ.`});
  }
  await(await db()).request()
    .input('sn',sql.NVarChar,d.sender).input('in',sql.NVarChar,d.inNum)
    .input('id2',sql.Date,d.inDate).input('tp',sql.NVarChar,d.type)
    .input('sb',sql.NVarChar,d.subject).input('rv',sql.NVarChar,d.receiver||null)
    .input('dp',sql.NVarChar,d.dept||null).input('st',sql.NVarChar,d.status||'جاري العمل')
    .input('ac',sql.NVarChar,JSON.stringify(d.actions||[]))
    .input('by',sql.NVarChar,d.recordedBy||null).input('bd',sql.NVarChar,d.recordedDept||null)
    .input('imp',sql.Bit,d.important?1:0).input('urg',sql.Bit,d.urgent?1:0)
    .input('fp',sql.NVarChar,d.filePath||null)
    .input('noi',sql.Bit,d.needsOrgInfo?1:0)
    .input('ong',sql.NVarChar,d.orgNameGuess||null)
    .query(`INSERT INTO OtherPartyEvents(SenderName,IncomingNum,IncomingDate,EventType,
      Subject,Receiver,Department,Status,Actions,RecordedBy,RecordedDept,IsImportant,IsUrgent,FilePath,NeedsOrgInfo,OrgNameGuess)
      VALUES(@sn,@in,@id2,@tp,@sb,@rv,@dp,@st,@ac,@by,@bd,@imp,@urg,@fp,@noi,@ong)`);
  res.json({ok:true});
}catch(e){
  // لو الحفظ اتمنع من الـ index الفريد UX_OtherPartyEvents_NoDup (طبقة حماية إضافية بعد فحص
  // التكرار الأساسي فوق) - نرجّع نفس رسالة التكرار الودية بدل خطأ SQL خام
  if(/duplicate key|UNIQUE KEY constraint/i.test(e.message)){
    return res.status(409).json({error:'⚠️ هذا الحدث مسجَّل بالفعل (نفس الاسم + رقم الوارد + التاريخ)'});
  }
  // لو الجدول مش موجود نعمله (أو ناقصه أعمدة هام/عاجل من نسخة قديمة) ونعيد المحاولة
  if(e.message.includes('Invalid object name')){
    try{
      await(await db()).request().query(`CREATE TABLE OtherPartyEvents(
        EventID INT IDENTITY(1,1) PRIMARY KEY,
        SenderName NVARCHAR(500),IncomingNum NVARCHAR(100),IncomingDate DATE,
        EventType NVARCHAR(100),Subject NVARCHAR(1000),Receiver NVARCHAR(200),
        Department NVARCHAR(100),Status NVARCHAR(50) DEFAULT N'جاري العمل',
        Actions NVARCHAR(MAX),RecordedBy NVARCHAR(200),RecordedDept NVARCHAR(100),
        IsImportant BIT NOT NULL DEFAULT 0, IsUrgent BIT NOT NULL DEFAULT 0,
        FilePath NVARCHAR(1000), NeedsOrgInfo BIT NOT NULL DEFAULT 0,
        OrgNameGuess NVARCHAR(500),
        CreatedAt DATETIME DEFAULT GETDATE())`);
      res.json({ok:true,note:'table created'});
    }catch(e2){res.status(500).json({error:e2.message});}
  } else if(e.message.includes('Invalid column name')){
    try{
      await(await db()).request().query(`
        IF COL_LENGTH('OtherPartyEvents','IsImportant') IS NULL ALTER TABLE OtherPartyEvents ADD IsImportant BIT NOT NULL DEFAULT 0;
        IF COL_LENGTH('OtherPartyEvents','IsUrgent') IS NULL ALTER TABLE OtherPartyEvents ADD IsUrgent BIT NOT NULL DEFAULT 0;
        IF COL_LENGTH('OtherPartyEvents','FilePath') IS NULL ALTER TABLE OtherPartyEvents ADD FilePath NVARCHAR(1000);
        IF COL_LENGTH('OtherPartyEvents','NeedsOrgInfo') IS NULL ALTER TABLE OtherPartyEvents ADD NeedsOrgInfo BIT NOT NULL DEFAULT 0;
        IF COL_LENGTH('OtherPartyEvents','OrgNameGuess') IS NULL ALTER TABLE OtherPartyEvents ADD OrgNameGuess NVARCHAR(500);`);
      res.json({ok:true,note:'columns added, please resend'});
    }catch(e2){res.status(500).json({error:e2.message});}
  } else res.status(500).json({error:e.message});
}});

app.get('/api/other-party-events',async(req,res)=>{try{
  const{sender,inNum,from,to,dept,status,eventType,important,urgent,receiver,createdFrom,createdTo,createdDay,needsOrgInfo}=req.query;
  const d=await db();const r=d.request();
  let q='SELECT* FROM OtherPartyEvents WHERE ISNULL(IsDeleted,0)=0';
  if(sender){q+=' AND SenderName LIKE @sn';r.input('sn',sql.NVarChar,'%'+sender+'%');}
  if(inNum){q+=' AND IncomingNum LIKE @in';r.input('in',sql.NVarChar,'%'+inNum+'%');}
  if(from){q+=' AND IncomingDate>=@fr';r.input('fr',sql.Date,from);}
  if(to){q+=' AND IncomingDate<=@to';r.input('to',sql.Date,to);}
  if(dept){q+=' AND Department=@dp';r.input('dp',sql.NVarChar,dept);}
  if(status){q+=' AND Status=@st';r.input('st',sql.NVarChar,status);}
  if(eventType){q+=' AND EventType=@et';r.input('et',sql.NVarChar,eventType);}
  // (جديد) بحث بالمستلم، وبفترة تاريخ التسجيل (CreatedAt)
  if(receiver){q+=' AND Receiver LIKE @rcv';r.input('rcv',sql.NVarChar,'%'+receiver+'%');}
  // (جديد) فلتر "جمعيات تحتاج معرفة بياناتها" - أحداث اتسجلت كـ"جهة أخرى" مؤقتًا لحد ما
  // حد يحدد لأي جمعية هي بالظبط (زر "🔁 تحويل إلى جمعية" الموجود بالفعل)
  if(needsOrgInfo==='1'){q+=' AND ISNULL(NeedsOrgInfo,0)=1';}
  // (تعديل) نفس منطق "يوم تسجيل محدد" + "من/إلى" مع بعض (OR) - راجعي الشرح في /api/events
  if(createdFrom||createdTo||createdDay){
    const conds=[];
    if(createdFrom||createdTo){
      let rc='1=1';
      if(createdFrom){rc+=' AND CreatedAt>=@cf';r.input('cf',sql.Date,createdFrom);}
      if(createdTo){rc+=' AND CreatedAt<DATEADD(day,1,@ct)';r.input('ct',sql.Date,createdTo);}
      conds.push('('+rc+')');
    }
    if(createdDay){
      conds.push('(CreatedAt>=@cd AND CreatedAt<DATEADD(day,1,@cd))');
      r.input('cd',sql.Date,createdDay);
    }
    q+=' AND ('+conds.join(' OR ')+')';
  }
  if(important==='1'){q+=' AND IsImportant=1';}
  if(urgent==='1'){q+=' AND IsUrgent=1';}
  q+=' ORDER BY CreatedAt DESC';
  try{
    res.json((await r.query(q)).recordset);
  }catch(e){
    if(e.message.includes('Invalid column name')){
      // عمود IsDeleted لسه ما اتضافش (قبل أول عملية حذف) - نرجّع القائمة كاملة بدون الفلترة دي
      const q2=q.replace('WHERE ISNULL(IsDeleted,0)=0','WHERE 1=1');
      res.json((await r.query(q2)).recordset);
    } else throw e;
  }
}catch(e){res.json([]);}});

// ══ تعديل حدث جهة أخرى (لتصحيح رقم/تاريخ الوارد أو أي بيان آخر بعد التسجيل) ══
// نفس قاعدة الأمان: فقط نفس الموظف اللي سجّل الحدث (بالاسم + إدارته وقت التسجيل RecordedDept)
// وعنده صلاحية "تعديل"، أو المدير العام.
app.put('/api/other-party-events/:id',async(req,res)=>{try{
  const d=req.body;
  const database=await db();
  const evR=await database.request().input('id',sql.Int,req.params.id)
    .query('SELECT EventID,RecordedBy,RecordedDept,SenderName FROM OtherPartyEvents WHERE EventID=@id');
  if(!evR.recordset.length) return res.status(404).json({error:'الحدث غير موجود'});
  const ev=evR.recordset[0];

  const reqName=d.RequesterName||null;
  const reqDept=d.RequesterDept||null;
  const reqAction=d.RequesterAction||null;
  const reqRole=d.RequesterRole||null;
  const isAdmin = reqRole==='admin' || reqAction==='admin';
  const isOwnerWithPermission = reqName && ev.RecordedBy && reqName===ev.RecordedBy
    && reqDept && reqDept===ev.RecordedDept && reqAction==='edit';
  if(!isAdmin && !isOwnerWithPermission){
    return res.status(403).json({error:'غير مسموح - التعديل مقصور على من قام بتسجيل هذا الحدث من الإدارة المختصة وله صلاحية تعديل'});
  }

  // ══ نفس فحص منع التكرار في الإضافة، بس هنا بنستثني الحدث نفسه من المقارنة، ولأن الاسم
  // (SenderName) ثابت مش قابل للتعديل من هنا، بنستخدم قيمته الحالية المسجَّلة أصلًا. ══
  if(d.IncomingNum && d.IncomingDate){
    const dup=await database.request().input('id',sql.Int,req.params.id)
      .input('sn',sql.NVarChar,ev.SenderName).input('in',sql.NVarChar,String(d.IncomingNum).trim()).input('id2',sql.Date,d.IncomingDate)
      .query(`SELECT TOP 1 EventID FROM OtherPartyEvents WHERE ISNULL(IsDeleted,0)=0 AND EventID<>@id
        AND SenderName=@sn AND IncomingNum=@in AND IncomingDate=@id2`);
    if(dup.recordset.length) return res.status(409).json({error:`⚠️ يوجد حدث آخر مسجَّل بالفعل بنفس الاسم ونفس رقم الوارد ونفس التاريخ (حدث رقم ${dup.recordset[0].EventID}) - عدّلي رقم الوارد أو التاريخ.`});
  }
  const r=await database.request().input('id',sql.Int,req.params.id)
    .input('et',sql.NVarChar,d.EventType||null).input('sb',sql.NVarChar,d.Subject||null)
    .input('dp',sql.NVarChar,d.Department||null)
    .input('in',sql.NVarChar,d.IncomingNum||null).input('ind',sql.Date,d.IncomingDate||null)
    .input('rv',sql.NVarChar,d.Receiver||null).input('st',sql.NVarChar,d.Status||'جاري العمل')
    .input('imp',sql.Bit,d.IsImportant?1:0).input('urg',sql.Bit,d.IsUrgent?1:0)
    .input('ac',sql.NVarChar,d.Actions?JSON.stringify(d.Actions):null)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .query(`UPDATE OtherPartyEvents SET EventType=@et,Subject=@sb,Department=@dp,
      IncomingNum=@in,IncomingDate=@ind,Receiver=@rv,Status=@st,IsImportant=@imp,IsUrgent=@urg,
      Actions=@ac,FilePath=@fp
      WHERE EventID=@id`);
  if(r.rowsAffected[0]===0) return res.status(404).json({error:'الحدث غير موجود'});
  res.json({ok:true});
}catch(e){
  if(/duplicate key|UNIQUE KEY constraint/i.test(e.message)) return res.status(409).json({error:'⚠️ هذا الحدث مسجَّل بالفعل (نفس الاسم + رقم الوارد + التاريخ)'});
  res.status(500).json({error:e.message});
}});

// ══ (جديد) إضافة إجراء على وارد "جهة أخرى" - نفس قاعدة /api/events/:id/action (إدارة الحدث أو المدير) ══
app.put('/api/other-party-events/:id/action',async(req,res)=>{try{
  const d=req.body||{};
  const database=await db();
  const evR=await database.request().input('id',sql.Int,req.params.id)
    .query('SELECT EventID,Department,RecordedDept FROM OtherPartyEvents WHERE EventID=@id AND ISNULL(IsDeleted,0)=0');
  if(!evR.recordset.length) return res.status(404).json({error:'الحدث غير موجود'});
  const ev=evR.recordset[0];
  const evDept=ev.Department||ev.RecordedDept;
  const isAdmin = d.RequesterRole==='admin' || d.RequesterAction==='admin';
  const sameDept = d.RequesterDept && d.RequesterDept===evDept && d.RequesterAction==='edit';
  if(!isAdmin && !sameDept) return res.status(403).json({error:'غير مسموح - إضافة الإجراء مقصورة على موظفي الإدارة المختصة بهذا الحدث'});
  await database.request().input('id',sql.Int,req.params.id)
    .input('st',sql.NVarChar,d.Status||'جاري العمل')
    .input('imp',sql.Bit,d.IsImportant?1:0).input('urg',sql.Bit,d.IsUrgent?1:0)
    .input('ac',sql.NVarChar,d.Actions?JSON.stringify(d.Actions):null)
    .input('fp',sql.NVarChar,d.FilePath||null)
    .query('UPDATE OtherPartyEvents SET Status=@st,IsImportant=@imp,IsUrgent=@urg,Actions=@ac,FilePath=@fp WHERE EventID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ── حذف حدث "جهة أخرى" - نفس منطق حذف حدث الجمعية بالظبط: سبب إجباري، ومسموح فقط
// للمدير العام، أو لمن سجّل الحدث بنفسه (بالاسم + إدارته وقت التسجيل) وله صلاحية "تعديل".
// حذف ناعم (Soft delete) عشان يفضل أثر/سجل تدقيق - زي حذف حدث الجمعية بالظبط.
app.delete('/api/other-party-events/:id',async(req,res)=>{try{
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const database=await db();
  const evR=await database.request().input('id',sql.Int,req.params.id)
    .query('SELECT EventID,RecordedBy,RecordedDept FROM OtherPartyEvents WHERE EventID=@id');
  if(!evR.recordset.length) return res.status(404).json({error:'الحدث غير موجود'});
  const ev=evR.recordset[0];

  const reqName=req.body.RequesterName||null;
  const reqDept=req.body.RequesterDept||null;
  const reqAction=req.body.RequesterAction||null;
  const reqRole=req.body.RequesterRole||null;
  const isAdmin = reqRole==='admin' || reqAction==='admin';
  const isOwnerWithPermission = reqName && ev.RecordedBy && reqName===ev.RecordedBy
    && reqDept && reqDept===ev.RecordedDept && reqAction==='edit';
  if(!isAdmin && !isOwnerWithPermission){
    return res.status(403).json({error:'غير مسموح - الحذف مقصور على من قام بتسجيل هذا الحدث من الإدارة المختصة وله صلاحية تعديل'});
  }

  try{
    const r=await database.request().input('id',sql.Int,req.params.id).input('rs',sql.NVarChar,reason).input('by',sql.NVarChar,reqName||null)
      .query('UPDATE OtherPartyEvents SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE EventID=@id');
    if(r.rowsAffected[0]===0) return res.status(404).json({error:'الحدث غير موجود'});
  }catch(e){
    if(e.message.includes('Invalid column name')){
      await database.request().query(`
        IF COL_LENGTH('OtherPartyEvents','IsDeleted') IS NULL ALTER TABLE OtherPartyEvents ADD IsDeleted BIT NOT NULL DEFAULT 0;
        IF COL_LENGTH('OtherPartyEvents','DeleteReason') IS NULL ALTER TABLE OtherPartyEvents ADD DeleteReason NVARCHAR(500);
        IF COL_LENGTH('OtherPartyEvents','DeletedBy') IS NULL ALTER TABLE OtherPartyEvents ADD DeletedBy NVARCHAR(200);
        IF COL_LENGTH('OtherPartyEvents','DeletedAt') IS NULL ALTER TABLE OtherPartyEvents ADD DeletedAt DATETIME;`);
      await database.request().input('id',sql.Int,req.params.id).input('rs',sql.NVarChar,reason).input('by',sql.NVarChar,reqName||null)
        .query('UPDATE OtherPartyEvents SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE EventID=@id');
    } else throw e;
  }
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ إحصاء موحّد لـ"آخر حدث" (جمعيات + طلبات إضافة جمعية معلّقة + جهات أخرى) ══
app.get('/api/stats/events',async(req,res)=>{try{
  const{source,inNum,from,to,dept,status,eventType,important,urgent,q}=req.query;
  const d=await db();
  const rows=[];

  // 1) أحداث الجمعيات (OrgEvents) - يشمل أيضاً طلبات إضافة الجمعية بعد قبولها
  if(!source||source==='org'){
    const r=d.request();
    let sql1=`SELECT e.EventID,e.OrgID,e.EventType,e.Subject,e.EventDate,e.Department,
      e.IncomingNum,e.IncomingDate,e.Receiver,e.Actions,e.Status,e.IsImportant,e.IsUrgent,
      e.RecordedBy,e.FilePath,e.SenderName,
      o.OrgName,o.RegNum,o.RegYear,o.Governorate
      FROM OrgEvents e JOIN Organizations o ON e.OrgID=o.OrgID WHERE ISNULL(e.IsDeleted,0)=0`;
    if(inNum){sql1+=' AND e.IncomingNum LIKE @in';r.input('in',sql.NVarChar,'%'+inNum+'%');}
    if(from){sql1+=' AND e.EventDate>=@fr';r.input('fr',sql.Date,from);}
    if(to){sql1+=' AND e.EventDate<=@to';r.input('to',sql.Date,to);}
    if(dept){sql1+=' AND e.Department=@dp';r.input('dp',sql.NVarChar,dept);}
    if(status){sql1+=' AND e.Status=@st';r.input('st',sql.NVarChar,status);}
    if(eventType){sql1+=' AND e.EventType=@et';r.input('et',sql.NVarChar,eventType);}
    if(important==='1')sql1+=' AND e.IsImportant=1';
    if(urgent==='1')sql1+=' AND e.IsUrgent=1';
    // (جديد) البحث الموحّد "q" بقى يشمل كمان الجهة المرسلة، عشان البحث الشامل في الموقع
    // يلاقي حدث الجمعية سواء بالموضوع أو باسم الجمعية أو باسم الجهة اللي أرسلته
    if(q){sql1+=' AND (e.Subject LIKE @q OR o.OrgName LIKE @q OR e.SenderName LIKE @q)';r.input('q',sql.NVarChar,'%'+q+'%');}
    try{
      const rs=await r.query(sql1);
      rs.recordset.forEach(e=>rows.push({
        Source:'جمعية', Name:e.OrgName, Reg:e.RegNum+'/'+(e.RegYear||''),
        EventID:e.EventID, OrgID:e.OrgID, Governorate:e.Governorate||'', RecordedBy:e.RecordedBy!=null?e.RecordedBy:null,
        FilePath:e.FilePath||'', SenderName:e.SenderName||'',
        IncomingNum:e.IncomingNum||'', IncomingDate:e.IncomingDate, EventDate:e.EventDate,
        EventType:e.EventType, Subject:e.Subject, Receiver:e.Receiver||'', Department:e.Department||'',
        Actions:e.Actions?safeParse(e.Actions):[], Status:e.Status||'جاري العمل',
        IsImportant:!!e.IsImportant, IsUrgent:!!e.IsUrgent
      }));
    }catch(e){/* تجاهل لو الأعمدة الجديدة لسه ما اتضافتش (قبل تشغيل ترقية قاعدة البيانات) */}
  }

  // 2) أحداث الجهات الأخرى (OtherPartyEvents)
  if(!source||source==='other'){
    const r=d.request();
    let sql2='SELECT* FROM OtherPartyEvents WHERE 1=1';
    if(inNum){sql2+=' AND IncomingNum LIKE @in';r.input('in',sql.NVarChar,'%'+inNum+'%');}
    if(from){sql2+=' AND IncomingDate>=@fr';r.input('fr',sql.Date,from);}
    if(to){sql2+=' AND IncomingDate<=@to';r.input('to',sql.Date,to);}
    if(dept){sql2+=' AND Department=@dp';r.input('dp',sql.NVarChar,dept);}
    if(status){sql2+=' AND Status=@st';r.input('st',sql.NVarChar,status);}
    if(eventType){sql2+=' AND EventType=@et';r.input('et',sql.NVarChar,eventType);}
    if(important==='1')sql2+=' AND IsImportant=1';
    if(urgent==='1')sql2+=' AND IsUrgent=1';
    if(q){sql2+=' AND (Subject LIKE @q OR SenderName LIKE @q)';r.input('q',sql.NVarChar,'%'+q+'%');}
    try{
      const rs=await r.query(sql2);
      rs.recordset.filter(e=>!e.IsDeleted).forEach(e=>rows.push({
        Source:'جهة أخرى', Name:e.SenderName, Reg:'—',
        EventID:e.EventID, RecordedBy:e.RecordedBy||'', RecordedDept:e.RecordedDept||null,
        FilePath:e.FilePath||'',
        IncomingNum:e.IncomingNum||'', IncomingDate:e.IncomingDate, EventDate:e.IncomingDate,
        EventType:e.EventType, Subject:e.Subject, Receiver:e.Receiver||'', Department:e.Department||'',
        Actions:e.Actions?safeParse(e.Actions):[], Status:e.Status||'جاري العمل',
        IsImportant:!!e.IsImportant, IsUrgent:!!e.IsUrgent
      }));
    }catch(e){/* الجدول ممكن يكون لسه ما اتعملش */}
  }

  // 3) "آخر حدث" المسجَّل مع طلبات إضافة جمعية لسه معلّقة (AdminData JSON)
  if(!source||source==='addreq'){
    try{
      const rs=await d.request().query(`SELECT ReqID,OrgName,Department,AdminData,CreatedAt FROM AddRequests
        WHERE Status=N'pending' AND AdminData IS NOT NULL`);
      rs.recordset.forEach(rr=>{
        const ad=safeParse(rr.AdminData);
        // (إصلاح) بيانات "آخر حدث" بقت متخزّنة متداخلة تحت ad.Event (مش مسطّحة على ad مباشرة)
        // من وقت ما اتبنى تدفّق submitAddReqB - فكانت كل الطلبات المعلّقة دي مش بتظهر خالص هنا.
        // نفس منطق فك التداخل المستخدم عند قبول الطلب فعليًا (ev = ad.Event || ad القديمة).
        const ev = ad ? (ad.Event || ((ad.EventType||ad.reqEv_actionType) ? ad : null)) : null;
        if(!ev||!(ev.EventType||ev.reqEv_actionType)) return;
        const evType=ev.EventType||ev.reqEv_actionType;
        const evSubject=ev.Subject||ev.reqEv_subject||'';
        const evDate=ev.EventDate||rr.CreatedAt;
        const evStatus=ev.Status||'جاري العمل';
        if(inNum && !(ev.IncomingNum||'').includes(inNum)) return;
        if(dept && rr.Department!==dept) return;
        if(status && evStatus!==status) return;
        if(eventType && evType!==eventType) return;
        if(important==='1' && !ev.IsImportant) return;
        if(urgent==='1' && !ev.IsUrgent) return;
        if(q && !((evSubject||'').includes(q)||(rr.OrgName||'').includes(q))) return;
        rows.push({
          Source:'طلب إضافة جمعية (معلّق)', Name:rr.OrgName, Reg:'—',
          IncomingNum:ev.IncomingNum||'', IncomingDate:ev.IncomingDate||'', EventDate:evDate,
          EventType:evType, Subject:evSubject, Receiver:ev.Receiver||'', Department:rr.Department||'',
          Actions:ev.Actions||[], Status:evStatus,
          IsImportant:!!ev.IsImportant, IsUrgent:!!ev.IsUrgent,
          FilePath:ev.FilePath||''
        });
      });
    }catch(e){/* تجاهل */}
  }

  rows.sort((a,b)=>String(b.EventDate||'').localeCompare(String(a.EventDate||'')));

  const summary={
    Total:rows.length,
    InProgress:rows.filter(x=>x.Status==='جاري العمل').length,
    Completed:rows.filter(x=>x.Status==='مكتمل').length,
    Important:rows.filter(x=>x.IsImportant).length,
    Urgent:rows.filter(x=>x.IsUrgent).length,
    ByDepartment:{}, BySource:{}, ByType:{}
  };
  rows.forEach(x=>{
    const dp=x.Department||'غير محدد'; summary.ByDepartment[dp]=(summary.ByDepartment[dp]||0)+1;
    summary.BySource[x.Source]=(summary.BySource[x.Source]||0)+1;
    const tp=x.EventType||'غير محدد'; summary.ByType[tp]=(summary.ByType[tp]||0)+1;
  });

  // ── (جديد) تفصيل حسب "الخانات" الفعلية المسجَّلة لهذه الإدارة تحديدًا، من جدول بياناتها
  // الحقيقي (منح/مشروعات/تشريعات/محظورة/جمع المال/منظمات) - مش بس تصنيف "آخر حدث" العام اللي
  // بيسجل حدث واحد لكل عملية تسجيل بغض النظر عن تفاصيلها. يظهر فقط لو تم تحديد إدارة بعينها.
  let deptBreakdown=null;
  if(dept){
    try{
      const rb=d.request();
      if(from)rb.input('fr',sql.Date,from);
      if(to)rb.input('to',sql.Date,to);
      if(dept==='المنح'){
        let q=`SELECT ISNULL(GrantType,N'غير محدد') AS Cat, COUNT(*) AS Cnt, SUM(ISNULL(Amount,0)) AS Total FROM Grants WHERE ISNULL(IsDeleted,0)=0`;
        if(from)q+=' AND CreatedAt>=@fr'; if(to)q+=' AND CreatedAt<=@to';
        q+=' GROUP BY GrantType';
        const rs=await rb.query(q);
        deptBreakdown={label:'نوع المنحة',valueLabel:'إجمالي المبلغ',items:rs.recordset.map(x=>({k:x.Cat,n:x.Cnt,v:x.Total}))};
      } else if(dept==='المشروعات'){
        let q=`SELECT ISNULL(ProjectType,N'غير محدد') AS Cat, COUNT(*) AS Cnt, SUM(ISNULL(Count,0)) AS Total FROM Projects WHERE ISNULL(IsDeleted,0)=0`;
        if(from)q+=' AND CreatedAt>=@fr'; if(to)q+=' AND CreatedAt<=@to';
        q+=' GROUP BY ProjectType';
        const rs=await rb.query(q);
        deptBreakdown={label:'نوع المشروع',valueLabel:'إجمالي العدد',items:rs.recordset.map(x=>({k:x.Cat,n:x.Cnt,v:x.Total}))};
      } else if(dept==='التشريعات'){
        let q=`SELECT ISNULL(DecreeType,N'غير محدد') AS Cat, COUNT(*) AS Cnt FROM Legislations WHERE ISNULL(IsDeleted,0)=0`;
        if(from)q+=' AND ISNULL(DecreeDate,CreatedAt)>=@fr'; if(to)q+=' AND ISNULL(DecreeDate,CreatedAt)<=@to';
        q+=' GROUP BY DecreeType';
        const rs=await rb.query(q);
        deptBreakdown={label:'نوع القرار',items:rs.recordset.map(x=>({k:x.Cat,n:x.Cnt}))};
      } else if(dept==='المحظورة'){
        let dateCond='';
        if(from)dateCond+=' AND ISNULL(DecreeDate,CreatedAt)>=@fr';
        if(to)dateCond+=' AND ISNULL(DecreeDate,CreatedAt)<=@to';
        const rs=await rb.query(`SELECT
          SUM(CASE WHEN FundsConfiscated=1 THEN 1 ELSE 0 END) AS FundsConfiscated,
          SUM(CASE WHEN ISNULL(IsBanned,0)=1 THEN 1 ELSE 0 END) AS IsBanned,
          SUM(CASE WHEN IsSuspended=1 THEN 1 ELSE 0 END) AS IsSuspended,
          SUM(CASE WHEN HasCase=1 THEN 1 ELSE 0 END) AS HasCase,
          SUM(CASE WHEN ISNULL(DissolutionInProgress,0)=1 THEN 1 ELSE 0 END) AS DissolutionInProgress,
          SUM(CASE WHEN DissolutionStatus=1 THEN 1 ELSE 0 END) AS DissolutionStatus
          FROM BannedOrgs WHERE ISNULL(IsDeleted,0)=0${dateCond}`);
        const x=rs.recordset[0]||{};
        deptBreakdown={label:'الحالة',items:[
          {k:'متحفَّظ على أموالها',n:x.FundsConfiscated||0},
          {k:'محظورة',n:x.IsBanned||0},
          {k:'موقوفة',n:x.IsSuspended||0},
          {k:'لديها قضية',n:x.HasCase||0},
          {k:'جاري إجراءات الحل',n:x.DissolutionInProgress||0},
          {k:'صدر حكم بالحل',n:x.DissolutionStatus||0},
        ].filter(i=>i.n>0)};
      } else if(dept==='جمع المال'){
        let q=`SELECT ISNULL(LicenseStatus,N'غير محدد') AS Cat, COUNT(*) AS Cnt FROM FundraisingLicenses WHERE ISNULL(IsDeleted,0)=0`;
        if(from)q+=' AND StartDate>=@fr'; if(to)q+=' AND StartDate<=@to';
        q+=' GROUP BY LicenseStatus';
        const rs=await rb.query(q);
        deptBreakdown={label:'حالة الترخيص',items:rs.recordset.map(x=>({k:x.Cat,n:x.Cnt}))};
      } else if(dept==='المنظمات'){
        let q=`SELECT ISNULL(u.Nationality,N'غير محدد') AS Cat, COUNT(*) AS Cnt FROM OrgUnits u JOIN OrgGeneralEntries e ON u.OrgEntryID=e.OrgEntryID WHERE ISNULL(u.IsActive,1)=1`;
        if(from)q+=' AND u.CreatedAt>=@fr'; if(to)q+=' AND u.CreatedAt<=@to';
        q+=' GROUP BY u.Nationality';
        const rs=await rb.query(q);
        deptBreakdown={label:'جنسية المنظمة',items:rs.recordset.map(x=>({k:x.Cat,n:x.Cnt}))};
      }
      // (القيد ماليهاش قسم خاص هنا لأن "بحسب النوع" أصلاً بيفصّلها: صفة النفع العام/تغيير اسم/نقل من مديرية/نقل إلى مديرية)
    }catch(e){ deptBreakdown=null; /* أي جدول لسه ناقصه عمود أو فاضي - الإحصاء الأساسي يفضل شغال عادي */ }
  }

  res.json({rows,summary,deptBreakdown});
}catch(e){res.status(500).json({error:e.message});}});

function safeParse(s){ try{ return JSON.parse(s); }catch(e){ return []; } }

// ══ طلبات التقارير (المسؤول/مسؤول تقارير الوزيرة) - مسجّلة حقيقيًا في قاعدة البيانات ══
// ينشئ المسؤول طلب تقرير جديد ويصبح هو النشط الوحيد (الطلبات القديمة تُغلق تلقائيًا)
app.post('/api/report-requests',async(req,res)=>{try{
  const d=req.body;
  if(!d.subject||!d.from||!d.to) return res.status(400).json({error:'الموضوع والفترة مطلوبة'});
  const conn=await db();
  await conn.request().query('UPDATE ReportRequests SET IsActive=0 WHERE IsActive=1');
  const r=conn.request()
    .input('subject',sql.NVarChar,d.subject)
    .input('from',sql.Date,d.from)
    .input('to',sql.Date,d.to)
    .input('deadline',sql.Date,d.deadline||null)
    .input('depts',sql.NVarChar,Array.isArray(d.depts)?d.depts.join(','):(d.depts||null))
    .input('createdBy',sql.Int,d.createdBy||null);
  const ins=await r.query(`INSERT INTO ReportRequests(Subject,PeriodFrom,PeriodTo,Deadline,Departments,IsActive,CreatedBy)
    OUTPUT INSERTED.RequestID
    VALUES(@subject,@from,@to,@deadline,@depts,1,@createdBy)`);
  res.json({ok:true,requestId:ins.recordset[0].RequestID});
}catch(e){res.status(500).json({error:e.message});}});

// يرجع طلب التقرير النشط حاليًا (لو موجود) عشان يظهر تنبيهه لكل المستخدمين حتى بعد تحديث الصفحة
app.get('/api/report-requests/active',async(req,res)=>{try{
  const conn=await db();
  const r=await conn.request().query(`SELECT TOP 1 RequestID AS id, Subject AS subject,
    CONVERT(varchar,PeriodFrom,23) AS [from], CONVERT(varchar,PeriodTo,23) AS [to],
    CONVERT(varchar,Deadline,23) AS deadline, Departments AS depts, CreatedBy AS createdBy,
    CONVERT(varchar,CreatedAt,23) AS createdAt
    FROM ReportRequests WHERE IsActive=1 ORDER BY CreatedAt DESC`);
  res.json(r.recordset[0]||null);
}catch(e){res.status(500).json({error:e.message});}});

// ── يتحقق إن المستخدم يملك صلاحية رفع/تعديل تقرير لإدارة معيّنة ──
// (المدير + صاحب صلاحية "كل الإدارات" مسموح لهم بأي إدارة، غيرهم فقط إدارته هو)
async function assertCanReportForDept(userId, dept){
  if(!userId) return {ok:false,error:'يجب تسجيل الدخول لرفع أو تعديل تقرير'};
  const conn=await db();
  const r=await conn.request().input('id',sql.Int,userId).query('SELECT Department,Permission FROM Users WHERE UserID=@id');
  if(!r.recordset.length) return {ok:false,error:'مستخدم غير معروف'};
  const u=r.recordset[0];
  const isPrivileged = u.Permission==='admin' || u.Department==='كل الإدارات';
  if(isPrivileged) return {ok:true};
  if(u.Department!==dept) return {ok:false,error:`لا تملك صلاحية رفع تقرير لإدارة أخرى غير إدارتك (${u.Department||'—'})`};
  return {ok:true};
}

// ── يتحقق إن المستخدم يملك صلاحية تعديل إجابة سؤال إلزامي مُجاب عليها بالفعل ──
// (المدير + صاحب صلاحية "mandatory_edit" المخصصة فقط - أي شخص آخر يقدر يجاوب أول مرة فقط ولا يقدر يغيّر إجابة موجودة)
async function assertCanEditAnswers(userId){
  if(!userId) return {ok:false,error:'يجب تسجيل الدخول لتعديل إجابة مسجّلة مسبقاً'};
  const conn=await db();
  const r=await conn.request().input('id',sql.Int,userId).query('SELECT Department,Permission FROM Users WHERE UserID=@id');
  if(!r.recordset.length) return {ok:false,error:'مستخدم غير معروف'};
  const u=r.recordset[0];
  const allowed = u.Permission==='admin' || u.Permission==='mandatory_edit';
  if(!allowed) return {ok:false,error:'هذه الإجابة مسجّلة بالفعل - تعديلها يقتصر على المسؤول المختص بتعديل الأسئلة الإلزامية'};
  return {ok:true};
}

// ══ التقارير (مسجّلة حقيقيًا في قاعدة البيانات - أرقام ثابتة لا تتغير مع تعديل الداتا) ══
app.post('/api/reports',async(req,res)=>{try{
  const d=req.body;
  const perm=await assertCanReportForDept(d.createdBy,d.dept);
  if(!perm.ok) return res.status(403).json({error:perm.error});
  const r=(await db()).request()
    .input('dept',sql.NVarChar,d.dept)
    .input('type',sql.NVarChar,d.type)
    .input('from',sql.Date,d.from)
    .input('to',sql.Date,d.to)
    .input('issued',sql.Int,d.issued||0)
    .input('active',sql.Int,d.active||0)
    .input('liquidated',sql.Int,d.liquidated||0)
    .input('revenue',sql.Decimal(18,2),d.revenue||0)
    .input('expenses',sql.Decimal(18,2),d.expenses||0)
    .input('net',sql.Decimal(18,2),d.net||0)
    .input('topOrg',sql.NVarChar,d.topOrg||null)
    .input('topAmount',sql.Decimal(18,2),d.topAmount||0)
    .input('purposes',sql.NVarChar,d.purposes||null)
    .input('methods',sql.NVarChar,d.methods||null)
    .input('notes',sql.NVarChar,d.notes||null)
    .input('filePath',sql.NVarChar,d.filePath||null)
    .input('reportData',sql.NVarChar,d.reportData?JSON.stringify(d.reportData):null)
    .input('createdBy',sql.Int,d.createdBy||null);
  await r.query(`INSERT INTO Reports
    (Department,ReportType,PeriodFrom,PeriodTo,IssuedCount,ActiveCount,LiquidatedCount,
     TotalRevenue,TotalExpenses,NetAmount,TopOrgName,TopOrgAmount,Purposes,Methods,Notes,FilePath,ReportData,CreatedBy)
    VALUES(@dept,@type,@from,@to,@issued,@active,@liquidated,@revenue,@expenses,@net,@topOrg,@topAmount,@purposes,@methods,@notes,@filePath,@reportData,@createdBy)`);
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/reports',async(req,res)=>{try{
  const{dept,type,from,to}=req.query;
  const d=await db();const r=d.request();
  // ── JOIN مع جدول المستخدمين عشان يظهر اسم الموظف اللي رفع كل تقرير فعليًا للمسؤول ──
  let q=`SELECT rp.ReportID,rp.Department AS dept,rp.ReportType AS type,
    CONVERT(varchar,rp.PeriodFrom,23) AS [from], CONVERT(varchar,rp.PeriodTo,23) AS [to],
    rp.IssuedCount AS issued, rp.ActiveCount AS active, rp.LiquidatedCount AS liquidated,
    rp.TotalRevenue AS revenue, rp.TotalExpenses AS expenses, rp.NetAmount AS net,
    rp.TopOrgName AS topOrg, rp.TopOrgAmount AS topAmount, rp.Purposes AS purposes, rp.Methods AS methods,
    rp.Notes AS notes, rp.FilePath AS filePath, rp.ReportData AS reportData,
    CONVERT(varchar,rp.CreatedAt,23) AS uploadedAt,
    rp.CreatedBy AS createdBy,
    COALESCE(u.FullName,N'غير معروف') AS uploadedBy,
    u.Department AS uploadedByDept
    FROM Reports rp LEFT JOIN Users u ON u.UserID=rp.CreatedBy WHERE 1=1`;
  if(dept){q+=' AND rp.Department=@dp';r.input('dp',sql.NVarChar,dept);}
  if(type){q+=' AND rp.ReportType=@tp';r.input('tp',sql.NVarChar,type);}
  if(from){q+=' AND rp.PeriodFrom>=@fr';r.input('fr',sql.Date,from);}
  if(to){q+=' AND rp.PeriodTo<=@to';r.input('to',sql.Date,to);}
  q+=' ORDER BY rp.PeriodFrom DESC';
  res.json((await r.query(q)).recordset);
}catch(e){res.status(500).json({error:e.message});}});

// ══ إحصاء "طبقًا للتقارير المسجَّلة" - أرقام ثابتة، لا تُعاد حسابها من البيانات الحية ══
app.get('/api/stats/by-reports',async(req,res)=>{try{
  const{dept,from,to}=req.query;
  if(!dept||!from||!to) return res.status(400).json({error:'الإدارة والفترة مطلوبة'});
  const d=await db();const r=d.request()
    .input('dept',sql.NVarChar,dept).input('from',sql.Date,from).input('to',sql.Date,to);
  // ── اتغيّرت من "احتواء تام" (PeriodFrom>=from AND PeriodTo<=to) إلى "تقاطع فعلي" (overlap):
  // أي تقرير رسمي بييجي بأي جزء منه داخل الفترة المطلوبة بيظهر، مش بس اللي محصور بالكامل جواها.
  // ده يسمح مثلاً بمقارنة شهر معيّن بتقرير سنوي بيغطيه، حتى لو التقرير أوسع من الشهر نفسه.
  const overlap = 'PeriodFrom<=@to AND PeriodTo>=@from';
  const result=await r.query(`SELECT
    COUNT(*) AS ReportsCount,
    SUM(IssuedCount) AS TotalIssued,
    SUM(ActiveCount) AS TotalActive,
    SUM(LiquidatedCount) AS TotalLiquidated,
    SUM(TotalRevenue) AS TotalRevenue,
    SUM(TotalExpenses) AS TotalExpenses,
    SUM(NetAmount) AS TotalNet
    FROM Reports WHERE Department=@dept AND ${overlap}`);
  const topOrg=await r.query(`SELECT TOP 1 TopOrgName,TopOrgAmount FROM Reports
    WHERE Department=@dept AND ${overlap}
    ORDER BY TopOrgAmount DESC`);

  // تجميع الأغراض والوسائل (عدد ونسبة) من كل التقارير المطابقة - بتوافق مع التقارير القديمة (نص مفصول بفواصل بدون أرقام)
  let purposesTotals={}, methodsTotals={};
  if(dept==='جمع المال'){
    const rows=await r.query(`SELECT Purposes,Methods FROM Reports WHERE Department=@dept AND ${overlap}`);
    const accumulate=(raw,acc)=>{
      if(!raw) return;
      let obj=null;
      try{ const j=JSON.parse(raw); if(j&&typeof j==='object') obj=j; }catch(e){}
      if(!obj){
        const tags=raw.split(/[,،]/).map(x=>x.trim()).filter(Boolean);
        obj={}; tags.forEach(t=>obj[t]=(obj[t]||0)+1);
      }
      Object.entries(obj).forEach(([k,v])=>{ acc[k]=(acc[k]||0)+(parseFloat(v)||0); });
    };
    rows.recordset.forEach(row=>{ accumulate(row.Purposes,purposesTotals); accumulate(row.Methods,methodsTotals); });
  }

  // ── تجميع بيانات باقي الإدارات (القيد/المنح/المشروعات/التشريعات/المحظورة/المنظمات) المخزَّنة فعليًا في عمود ReportData ──
  let reportDataTotals={};
  if(dept!=='جمع المال'){
    const rdRows=await r.query(`SELECT ReportData FROM Reports WHERE Department=@dept AND ${overlap}`);
    rdRows.recordset.forEach(row=>{
      if(!row.ReportData) return;
      let obj=null;
      try{ obj=JSON.parse(row.ReportData); }catch(e){}
      if(!obj||typeof obj!=='object') return;
      Object.entries(obj).forEach(([k,v])=>{ reportDataTotals[k]=(reportDataTotals[k]||0)+(parseFloat(v)||0); });
    });
  }

  // ── قائمة التقارير المتقاطعة نفسها (بفتراتها الحقيقية) عشان تظهر للمستخدم أي تقارير بالظبط
  // دخلت في الحساب، تفاديًا لأي التباس حول ازاي الرقم اتجمع ──
  const matched=(await r.query(`SELECT ReportID,ReportType,CONVERT(varchar,PeriodFrom,23) AS [from],CONVERT(varchar,PeriodTo,23) AS [to] FROM Reports WHERE Department=@dept AND ${overlap} ORDER BY PeriodFrom`)).recordset;

  res.json({...result.recordset[0],topOrg:topOrg.recordset[0]||null,purposesTotals,methodsTotals,reportDataTotals,matchedReports:matched});
}catch(e){res.status(500).json({error:e.message});}});

// ══ تعديل تقرير مسجَّل (نفس أعمدة الإضافة + تحديث حقيقي في قاعدة البيانات) ══
app.put('/api/reports/:id',async(req,res)=>{try{
  const id=req.params.id;
  const d=req.body;
  const perm=await assertCanReportForDept(d.createdBy,d.dept);
  if(!perm.ok) return res.status(403).json({error:perm.error});
  const r=(await db()).request()
    .input('id',sql.Int,id)
    .input('dept',sql.NVarChar,d.dept)
    .input('type',sql.NVarChar,d.type)
    .input('from',sql.Date,d.from)
    .input('to',sql.Date,d.to)
    .input('issued',sql.Int,d.issued||0)
    .input('active',sql.Int,d.active||0)
    .input('liquidated',sql.Int,d.liquidated||0)
    .input('revenue',sql.Decimal(18,2),d.revenue||0)
    .input('expenses',sql.Decimal(18,2),d.expenses||0)
    .input('net',sql.Decimal(18,2),d.net||0)
    .input('topOrg',sql.NVarChar,d.topOrg||null)
    .input('topAmount',sql.Decimal(18,2),d.topAmount||0)
    .input('purposes',sql.NVarChar,d.purposes||null)
    .input('methods',sql.NVarChar,d.methods||null)
    .input('notes',sql.NVarChar,d.notes||null)
    .input('filePath',sql.NVarChar,d.filePath||null)
    .input('reportData',sql.NVarChar,d.reportData?JSON.stringify(d.reportData):null);
  const upd=await r.query(`UPDATE Reports SET
    Department=@dept, ReportType=@type, PeriodFrom=@from, PeriodTo=@to,
    IssuedCount=@issued, ActiveCount=@active, LiquidatedCount=@liquidated,
    TotalRevenue=@revenue, TotalExpenses=@expenses, NetAmount=@net,
    TopOrgName=@topOrg, TopOrgAmount=@topAmount,
    Purposes=@purposes, Methods=@methods, Notes=@notes,
    FilePath=COALESCE(@filePath,FilePath),
    ReportData=@reportData
    WHERE ReportID=@id`);
  if(!upd.rowsAffected[0]) return res.status(404).json({error:'التقرير غير موجود'});
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ حذف تقرير مسجَّل ══
app.delete('/api/reports/:id',async(req,res)=>{try{
  const id=req.params.id;
  const del=await(await db()).request().input('id',sql.Int,id).query('DELETE FROM Reports WHERE ReportID=@id');
  if(!del.rowsAffected[0]) return res.status(404).json({error:'التقرير غير موجود'});
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ الأغراض والوسائل (جمع المال) ══
app.get('/api/fundraising-purposes',async(req,res)=>{try{
  res.json((await(await db()).request().query('SELECT Name FROM FundraisingPurposes WHERE IsActive=1')).recordset.map(x=>x.Name));
}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/fundraising-methods',async(req,res)=>{try{
  res.json((await(await db()).request().query('SELECT Name FROM FundraisingMethods WHERE IsActive=1')).recordset.map(x=>x.Name));
}catch(e){res.status(500).json({error:e.message});}});

// ══ التقرير المجمّع - أرقام حقيقية من قاعدة البيانات (بدل الأرقام الوهمية) ══
app.get('/api/stats/master',async(req,res)=>{try{
  const d=await db();
  const orgs=await d.request().query('SELECT COUNT(*) AS Total FROM Organizations WHERE IsActive=1');
  const revenue=await d.request().query('SELECT SUM(Revenue) AS Total FROM FundraisingLicenses');
  const grants=await d.request().query('SELECT COUNT(DISTINCT OrgID) AS Total FROM Grants');
  const activeLicensesFromReports=await d.request().query(`SELECT SUM(ActiveCount) AS Total FROM Reports WHERE Department=N'جمع المال'`);
  const totalGrants=await d.request().query('SELECT SUM(Amount) AS Total FROM Grants');
  const activeProjects=await d.request().query(`SELECT COUNT(*) AS Total FROM Projects WHERE IsAssigned=1`);
  const banned=await d.request().query('SELECT COUNT(*) AS Total FROM BannedOrgs');
  const orgUnits=await d.request().query('SELECT COUNT(*) AS Total FROM OrgUnits WHERE IsActive=1');
  res.json({
    totalOrgs:orgs.recordset[0].Total||0,
    fundraisingRevenue:revenue.recordset[0].Total||0,
    orgsWithGrants:grants.recordset[0].Total||0,
    totalGrantsAmount:totalGrants.recordset[0].Total||0,
    activeLicenses:activeLicensesFromReports.recordset[0].Total||0,
    activeProjects:activeProjects.recordset[0].Total||0,
    bannedOrgs:banned.recordset[0].Total||0,
    orgUnitsTotal:orgUnits.recordset[0].Total||0
  });
}catch(e){res.status(500).json({error:e.message});}});

// ══ إحصاء التراخيص ══
app.get('/api/licenses-stats',async(req,res)=>{try{
  const{from,to}=req.query;
  const r=await(await db()).request()
    .input('from',sql.Int,parseInt(from)||2020)
    .input('to',sql.Int,parseInt(to)||2026)
    .query(`SELECT COUNT(DISTINCT OrgID) AS TotalOrgsWithLicenses,
      COUNT(*) AS TotalLicenses,
      SUM(Revenue) AS TotalRevenue,
      SUM(Expenses) AS TotalExpenses,
      SUM(NetAmount) AS TotalNet
      FROM FundraisingLicenses
      WHERE IssueYear BETWEEN @from AND @to`);
  res.json(r.recordset[0]);
}catch(e){res.status(500).json({error:e.message});}});

// ══ إحصاء حسب المحافظات (لكل محافظة: عدد الكيانات، تراخيص جمع المال، المنح، الجهات المحظورة) ══
app.get('/api/stats/by-governorate',async(req,res)=>{try{
  const{type,level,fromYear,toYear,fromDate,toDate}=req.query;
  const d=await db();const r=d.request();
  let typeFilter='';
  if(type){typeFilter=' AND o.OrgType=@tp';r.input('tp',sql.NVarChar,type);}
  if(level){typeFilter+=' AND o.Level=@lv';r.input('lv',sql.NVarChar,level);}
  let yearFilter='';
  if(fromYear){yearFilter+=' AND o.RegYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
  if(toYear){yearFilter+=' AND o.RegYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
  if(fromDate){yearFilter+=' AND o.RegDate>=@fd';r.input('fd',sql.Date,fromDate);}
  if(toDate){yearFilter+=' AND o.RegDate<=@td';r.input('td',sql.Date,toDate);}
  const q=`SELECT
    o.Governorate,
    COUNT(*) AS OrgsCount,
    SUM(CASE WHEN o.PublicBenefit=1 THEN 1 ELSE 0 END) AS PublicBenefitCount,
    (SELECT COUNT(*) FROM FundraisingLicenses fl JOIN Organizations o2 ON fl.OrgID=o2.OrgID
      WHERE o2.Governorate=o.Governorate AND o2.IsActive=1 ${(typeFilter+yearFilter).replace(/o\./g,'o2.')}) AS LicensesCount,
    (SELECT SUM(fl.Revenue) FROM FundraisingLicenses fl JOIN Organizations o2 ON fl.OrgID=o2.OrgID
      WHERE o2.Governorate=o.Governorate AND o2.IsActive=1 ${(typeFilter+yearFilter).replace(/o\./g,'o2.')}) AS TotalRevenue,
    (SELECT COUNT(DISTINCT g.OrgID) FROM Grants g JOIN Organizations o2 ON g.OrgID=o2.OrgID
      WHERE o2.Governorate=o.Governorate AND o2.IsActive=1 ${(typeFilter+yearFilter).replace(/o\./g,'o2.')}) AS OrgsWithGrants,
    (SELECT COUNT(DISTINCT p.OrgID) FROM Projects p JOIN Organizations o2 ON p.OrgID=o2.OrgID
      WHERE o2.Governorate=o.Governorate AND o2.IsActive=1 ${(typeFilter+yearFilter).replace(/o\./g,'o2.')}) AS OrgsWithProjects,
    (SELECT COUNT(*) FROM Legislations lg JOIN Organizations o2 ON lg.OrgID=o2.OrgID
      WHERE o2.Governorate=o.Governorate AND o2.IsActive=1 ${(typeFilter+yearFilter).replace(/o\./g,'o2.')}) AS LegislationsCount,
    (SELECT COUNT(*) FROM BannedOrgs b JOIN Organizations o2 ON b.OrgID=o2.OrgID
      WHERE o2.Governorate=o.Governorate AND o2.IsActive=1 ${(typeFilter+yearFilter).replace(/o\./g,'o2.')}) AS BannedCount
    FROM Organizations o
    WHERE o.IsActive=1 AND o.Governorate IS NOT NULL ${typeFilter}${yearFilter}
    GROUP BY o.Governorate
    ORDER BY OrgsCount DESC`;
  const result=await r.query(q);
  res.json(result.recordset);
}catch(e){res.status(500).json({error:e.message});}});

// ══ إحصاء النفع العام ══
app.get('/api/stats/public-benefit',async(req,res)=>{try{
  const{gov,type,fromYear,toYear}=req.query;
  const d=await db();const r=d.request();
  let q="SELECT COUNT(*) AS Count FROM Organizations WHERE PublicBenefit=1 AND IsActive=1";
  if(gov){q+=' AND Governorate=@gv';r.input('gv',sql.NVarChar,gov);}
  if(type){q+=' AND OrgType=@tp';r.input('tp',sql.NVarChar,type);}
  if(fromYear){q+=' AND RegYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
  if(toYear){q+=' AND RegYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
  res.json((await r.query(q)).recordset[0]);
}catch(e){res.status(500).json({error:e.message});}});

// ══ الأسئلة الإلزامية - إدارة (عرض/إضافة/تعديل) - كانت الواجهة بتعرض بيانات وهمية بالكامل ══
app.get('/api/mandatory-questions',async(req,res)=>{try{
  const{dept}=req.query;
  const d=await db();const r=d.request();
  let q='SELECT QuestionID,QuestionText,Department,QuestionType,Options,IsActive FROM MandatoryQuestions WHERE IsActive=1';
  if(dept){q+=' AND Department=@dp';r.input('dp',sql.NVarChar,dept);}
  q+=' ORDER BY QuestionID';
  res.json((await r.query(q)).recordset);
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/mandatory-questions',async(req,res)=>{try{
  const{text,dept,type,options,addedBy}=req.body;
  if(!text||!dept) return res.status(400).json({error:'نص السؤال والإدارة مطلوبين'});
  const d=await db();const r=d.request();
  r.input('txt',sql.NVarChar,text);
  r.input('dp',sql.NVarChar,dept);
  r.input('tp',sql.NVarChar,type||'yesno');
  r.input('op',sql.NVarChar,options||null);
  r.input('ab',sql.Int,addedBy||null);
  const result=await r.query(`INSERT INTO MandatoryQuestions(QuestionText,Department,QuestionType,Options,AddedBy)
    OUTPUT INSERTED.QuestionID VALUES(@txt,@dp,@tp,@op,@ab)`);
  res.json({success:true,questionId:result.recordset[0].QuestionID});
}catch(e){res.status(500).json({error:e.message});}});

app.put('/api/mandatory-questions/:id',async(req,res)=>{try{
  const id=parseInt(req.params.id);
  const{text,dept,type,isActive}=req.body;
  const d=await db();const r=d.request();
  r.input('id',sql.Int,id);
  const sets=[];
  if(text!==undefined){sets.push('QuestionText=@txt');r.input('txt',sql.NVarChar,text);}
  if(dept!==undefined){sets.push('Department=@dp');r.input('dp',sql.NVarChar,dept);}
  if(type!==undefined){sets.push('QuestionType=@tp');r.input('tp',sql.NVarChar,type);}
  if(isActive!==undefined){sets.push('IsActive=@ia');r.input('ia',sql.Bit,isActive?1:0);}
  if(!sets.length) return res.status(400).json({error:'لا توجد بيانات للتحديث'});
  await r.query(`UPDATE MandatoryQuestions SET ${sets.join(',')} WHERE QuestionID=@id`);
  res.json({success:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ لوحة/شاشة "إكسل" لكل الجمعيات وإجاباتها على الأسئلة الإلزامية - خاصة بالمسؤول المختص بالتعديل ══
// (لازم تكون معرَّفة قبل /:orgId عشان Express ميفهمش "board" على إنها رقم جمعية)
app.get('/api/question-answers/board',async(req,res)=>{try{
  const{search,requestedBy}=req.query;
  const perm=await assertCanEditAnswers(requestedBy?parseInt(requestedBy):null);
  if(!perm.ok) return res.status(403).json({error:perm.error});

  const d=await db();
  const orgsReq=d.request();
  let oq=`SELECT OrgID,OrgName,RegNum,RegYear,Governorate FROM Organizations WHERE IsActive=1`;
  if(search){oq+=` AND (OrgName LIKE @s OR CAST(RegNum AS NVARCHAR) LIKE @s)`;orgsReq.input('s',sql.NVarChar,'%'+search+'%');}
  oq+=' ORDER BY OrgName';
  const orgs=(await orgsReq.query(oq)).recordset;

  const questions=(await d.request().query(
    `SELECT QuestionID,QuestionText,Department FROM MandatoryQuestions WHERE IsActive=1 ORDER BY QuestionID`)).recordset;

  const answersRs=await d.request().query(`
    SELECT OrgID, QuestionID, Answer FROM(
      SELECT OrgID, QuestionID, Answer, AnsweredAt,
        ROW_NUMBER() OVER(PARTITION BY OrgID, QuestionID ORDER BY AnsweredAt DESC) AS rn
      FROM QuestionAnswers
    ) t WHERE rn=1`);
  const map={};
  for(const a of answersRs.recordset){
    if(!map[a.OrgID]) map[a.OrgID]={};
    map[a.OrgID][a.QuestionID]=a.Answer;
  }

  const rows=orgs.map(o=>({
    OrgID:o.OrgID,OrgName:o.OrgName,RegNum:o.RegNum,RegYear:o.RegYear,Governorate:o.Governorate,
    answers:map[o.OrgID]||{}
  }));
  res.json({questions,rows});
}catch(e){res.status(500).json({error:e.message});}});

// ══ إجابات الأسئلة الإلزامية لكيان معيّن - حفظ وقت التسجيل + عرضها وقت المراجعة ══
app.get('/api/question-answers/:orgId',async(req,res)=>{try{
  const orgId=parseInt(req.params.orgId);
  const d=await db();
  const rs=await d.request().input('oid',sql.Int,orgId).query(`
    SELECT QuestionID, Answer FROM(
      SELECT QuestionID, Answer, AnsweredAt,
        ROW_NUMBER() OVER(PARTITION BY QuestionID ORDER BY AnsweredAt DESC) AS rn
      FROM QuestionAnswers WHERE OrgID=@oid
    ) t WHERE rn=1`);
  res.json(rs.recordset);
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/question-answers',async(req,res)=>{try{
  const{orgId,answers,answeredBy}=req.body;
  const oid=parseInt(orgId);
  if(!oid||!Array.isArray(answers)||!answers.length) return res.status(400).json({error:'بيانات ناقصة'});
  const d=await db();

  // ── نجيب أسئلة الجمعية دي اللي اتجاوبت من قبل، عشان نعرف أي إجابة "جديدة" (مسموحة لأي مستخدم)
  //    وأي إجابة "تعديل" لإجابة موجودة (مسموحة للمسؤول المختص فقط) ──
  const existingRs=await d.request().input('oid',sql.Int,oid).query(
    `SELECT DISTINCT QuestionID FROM QuestionAnswers WHERE OrgID=@oid`);
  const answeredBefore=new Set(existingRs.recordset.map(x=>x.QuestionID));

  const isEditingExisting=answers.some(a=>answeredBefore.has(parseInt(a.questionId)));
  if(isEditingExisting){
    const perm=await assertCanEditAnswers(answeredBy);
    if(!perm.ok) return res.status(403).json({error:perm.error});
  }

  const saved=[];
  for(const a of answers){
    if(a.answer===undefined||a.answer===null||String(a.answer).trim()==='') continue;
    const r=d.request();
    r.input('oid',sql.Int,oid);
    r.input('qid',sql.Int,parseInt(a.questionId));
    r.input('ans',sql.NVarChar,String(a.answer));
    r.input('ab',sql.Int,answeredBy||null);
    await r.query(`INSERT INTO QuestionAnswers(OrgID,QuestionID,Answer,AnsweredBy) VALUES(@oid,@qid,@ans,@ab)`);
    saved.push(parseInt(a.questionId));
  }
  res.json({success:true,saved});
}catch(e){res.status(500).json({error:e.message});}});

// ══ إحصاء الأسئلة الإلزامية - بيانات حقيقية من جدولي MandatoryQuestions و QuestionAnswers ══
// (كانت الصفحة سابقاً بتعرض بيانات التراخيص/النفع العام فقط ومن غير فلترة بالسنة - تم ربطها بالجداول الصحيحة)
app.get('/api/stats/mandatory-questions',async(req,res)=>{try{
  const{gov,type,fromYear,toYear}=req.query;
  const d=await db();

  function addOrgFilters(rq){
    let frag='';
    if(gov){frag+=' AND o.Governorate=@gv';rq.input('gv',sql.NVarChar,gov);}
    if(type){frag+=' AND o.OrgType=@tp';rq.input('tp',sql.NVarChar,type);}
    if(fromYear){frag+=' AND o.RegYear>=@fy';rq.input('fy',sql.Int,parseInt(fromYear));}
    if(toYear){frag+=' AND o.RegYear<=@ty';rq.input('ty',sql.Int,parseInt(toYear));}
    return frag;
  }

  const totalReq=d.request();
  const totalFrag=addOrgFilters(totalReq);
  const totalResult=await totalReq.query(`SELECT COUNT(*) AS Total FROM Organizations o WHERE o.IsActive=1 ${totalFrag}`);
  const total=totalResult.recordset[0].Total||0;

  const questions=(await d.request().query(
    `SELECT QuestionID,QuestionText,Department,QuestionType FROM MandatoryQuestions WHERE IsActive=1 ORDER BY QuestionID`
  )).recordset;

  const results=[];
  for(const qz of questions){
    const qReq=d.request();
    const qFrag=addOrgFilters(qReq);
    qReq.input('qid',sql.Int,qz.QuestionID);
    const rs=await qReq.query(`
      SELECT Answer, COUNT(*) AS Cnt FROM(
        SELECT qa.OrgID, qa.Answer,
          ROW_NUMBER() OVER(PARTITION BY qa.OrgID ORDER BY qa.AnsweredAt DESC) AS rn
        FROM QuestionAnswers qa
        JOIN Organizations o ON o.OrgID=qa.OrgID
        WHERE qa.QuestionID=@qid AND o.IsActive=1 ${qFrag}
      ) t WHERE rn=1
      GROUP BY Answer`);
    const answered=rs.recordset.reduce((s,x)=>s+x.Cnt,0);
    results.push({
      questionId:qz.QuestionID,
      text:qz.QuestionText,
      department:qz.Department,
      type:qz.QuestionType,
      answered,
      notAnswered:Math.max(0,total-answered),
      breakdown:rs.recordset
    });
  }

  res.json({total,questions:results});
}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════
// ══ موديول "المنظمات" الحقيقي (كان وهمياً بالكامل - تم بناؤه من الصفر) ══
// ══════════════════════════════════════════════════

// قوائم الاختيار (نشاط / غرض / جنسية) + إضافة اختيار جديد من الواجهة
app.get('/api/org-lookups',async(req,res)=>{try{
  const d=await db();
  const act=await d.request().query('SELECT ID,Name FROM OrgActivityTypes WHERE IsActive=1 ORDER BY ID');
  const pur=await d.request().query('SELECT ID,Name FROM OrgPurposeTypes WHERE IsActive=1 ORDER BY ID');
  const nat=await d.request().query('SELECT ID,Name FROM OrgNationalityTypes WHERE IsActive=1 ORDER BY ID');
  res.json({activities:act.recordset,purposes:pur.recordset,nationalities:nat.recordset});
}catch(e){res.status(500).json({error:e.message});}});

app.post('/api/org-lookups',async(req,res)=>{try{
  const{listType,name}=req.body;
  const tables={activity:'OrgActivityTypes',purpose:'OrgPurposeTypes',nationality:'OrgNationalityTypes'};
  const table=tables[listType];
  if(!table||!name||!name.trim()) return res.status(400).json({error:'بيانات غير صحيحة'});
  const d=await db();
  const dup=await d.request().input('nm',sql.NVarChar,name.trim()).query(`SELECT ID FROM ${table} WHERE Name=@nm`);
  if(dup.recordset.length) return res.json({ok:true,ID:dup.recordset[0].ID,existed:true});
  const ins=await d.request().input('nm',sql.NVarChar,name.trim())
    .query(`INSERT INTO ${table}(Name) OUTPUT INSERTED.ID VALUES(@nm)`);
  res.json({ok:true,ID:ins.recordset[0].ID});
}catch(e){res.status(500).json({error:e.message});}});

// تسجيل واقعة منظمات جديدة - مرتبطة بجمعية محددة (OrgID) وتدعم أكثر من منظمة (Units) بنفس التسجيل
app.post('/api/org-entries',async(req,res)=>{try{
  const d=req.body;
  const units=Array.isArray(d.Units)?d.Units:[];
  if(!d.OrgID) return res.status(400).json({error:'يجب اختيار الجمعية أولاً (من خطوة البيانات الثابتة)'});
  if(!units.length) return res.status(400).json({error:'أضف منظمة واحدة على الأقل قبل الحفظ'});
  const db2=await db();
  // رقم تسلسلي (يُكتب يدويًا) + تاريخ - بنفس فكرة رقم الترخيص في جمع المال بالظبط:
  // التكرار الممنوع = نفس الجمعية + نفس الرقم التسلسلي + نفس سنة التاريخ معًا.
  const entP=ymParts(d.EntryDate);
  const entryYear=(entP?entP.y:null)||d.EntryYear||parseInt(d.EventYear)||null;
  if(d.SerialNumber){
    const dup=await db2.request().input('oid',sql.Int,parseInt(d.OrgID)).input('sn',sql.NVarChar,d.SerialNumber)
      .input('ey',sql.Int,entryYear)
      .query('SELECT OrgEntryID FROM OrgGeneralEntries WHERE OrgID=@oid AND SerialNumber=@sn AND ISNULL(EntryYear,-1)=ISNULL(@ey,-1) AND ISNULL(IsActive,1)=1');
    if(dup.recordset.length)return res.status(409).json({error:'تم تسجيل هذا الرقم التسلسلي من قبل لنفس الجمعية ونفس السنة'});
  }
  const ins=await db2.request()
    .input('oid',sql.Int,parseInt(d.OrgID))
    .input('em',sql.Int,parseInt(d.EventMonth))
    .input('ey',sql.Int,parseInt(d.EventYear))
    .input('nt',sql.NVarChar,d.Notes||null)
    .input('sn',sql.NVarChar,d.SerialNumber||null).input('ed',sql.Date,d.EntryDate||null).input('eyr',sql.Int,entryYear)
    .input('by',sql.Int,d.CreatedBy||null)
    .query(`INSERT INTO OrgGeneralEntries(OrgID,EventMonth,EventYear,Notes,SerialNumber,EntryDate,EntryYear,CreatedBy)
      OUTPUT INSERTED.OrgEntryID VALUES(@oid,@em,@ey,@nt,@sn,@ed,@eyr,@by)`);
  const entryId=ins.recordset[0].OrgEntryID;

  for(const u of units){
    const unitName=(u.UnitName||'').trim();
    if(!unitName) continue;
    const unitIns=await db2.request()
      .input('eid',sql.Int,entryId)
      .input('nm',sql.NVarChar,unitName)
      .input('nat',sql.NVarChar,u.Nationality||null)
      .input('pur',sql.NVarChar,u.Purpose||null)
      .input('ren',sql.Bit,u.LicenseRenewed?1:0)
      .input('amd',sql.Bit,u.LicenseAmended?1:0)
      .input('nts',sql.NVarChar,u.Notes||null)
      .query(`INSERT INTO OrgUnits(OrgEntryID,UnitName,Nationality,Purpose,LicenseRenewed,LicenseAmended,Notes)
        OUTPUT INSERTED.UnitID VALUES(@eid,@nm,@nat,@pur,@ren,@amd,@nts)`);
    const unitId=unitIns.recordset[0].UnitID;
    const activities=Array.isArray(u.Activities)?u.Activities:[];
    for(const a of activities){
      await db2.request().input('uid',sql.Int,unitId).input('nm',sql.NVarChar,a)
        .query('INSERT INTO OrgUnitActivities(UnitID,ActivityName) VALUES(@uid,@nm)');
    }
  }
  res.json({ok:true,OrgEntryID:entryId,UnitsCount:units.length});
}catch(e){res.status(500).json({error:e.message});}});

// قائمة التسجيلات (مع فلاتر شهر/سنة/فترة/جمعية) - كل تسجيل يظهر مع منظماته وبيانات الجمعية
app.get('/api/org-entries',async(req,res)=>{try{
  const{fromYear,toYear,month,orgId}=req.query;
  const d=await db();const r=d.request();
  let q=`SELECT e.*, o.OrgName, o.RegNum, o.RegYear AS OrgRegYear, o.Governorate
    FROM OrgGeneralEntries e LEFT JOIN Organizations o ON e.OrgID=o.OrgID
    WHERE e.IsActive=1`;
  if(fromYear){q+=' AND e.EventYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
  if(toYear){q+=' AND e.EventYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
  if(month){q+=' AND e.EventMonth=@mo';r.input('mo',sql.Int,parseInt(month));}
  if(orgId){q+=' AND e.OrgID=@oid';r.input('oid',sql.Int,parseInt(orgId));}
  q+=' ORDER BY e.EventYear DESC,e.EventMonth DESC,e.OrgEntryID DESC';
  const list=(await r.query(q)).recordset;
  // إرفاق منظمات كل تسجيل (كل منظمة بأنشطتها الخاصة)
  for(const row of list){
    const d2=await db();
    const units=(await d2.request().input('id',sql.Int,row.OrgEntryID)
      .query('SELECT * FROM OrgUnits WHERE OrgEntryID=@id AND IsActive=1 ORDER BY UnitID')).recordset;
    for(const u of units){
      const d3=await db();
      u.Activities=(await d3.request().input('uid',sql.Int,u.UnitID)
        .query('SELECT ActivityName FROM OrgUnitActivities WHERE UnitID=@uid')).recordset.map(x=>x.ActivityName);
    }
    row.Units=units;
    row.OrgCount=units.length;
  }
  res.json(list);
}catch(e){res.status(500).json({error:e.message});}});

app.delete('/api/org-entries/:id',async(req,res)=>{try{
  await(await db()).request().input('id',sql.Int,req.params.id)
    .query('UPDATE OrgGeneralEntries SET IsActive=0 WHERE OrgEntryID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// تعديل بيانات منظمة واحدة بعينها (من شاشة "تعديل بيانات")
app.put('/api/org-units/:id',async(req,res)=>{try{
  const d=req.body;
  const unitName=(d.UnitName||'').trim();
  if(!unitName) return res.status(400).json({error:'اسم المنظمة مطلوب'});
  await(await db()).request()
    .input('id',sql.Int,req.params.id)
    .input('nm',sql.NVarChar,unitName)
    .input('nat',sql.NVarChar,d.Nationality||null)
    .input('pur',sql.NVarChar,d.Purpose||null)
    .input('ren',sql.Bit,d.LicenseRenewed?1:0)
    .input('amd',sql.Bit,d.LicenseAmended?1:0)
    .query(`UPDATE OrgUnits SET UnitName=@nm,Nationality=@nat,Purpose=@pur,LicenseRenewed=@ren,LicenseAmended=@amd WHERE UnitID=@id`);
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// حذف منظمة واحدة بعينها (حذف منطقي - IsActive=0)
app.delete('/api/org-units/:id',async(req,res)=>{try{
  await(await db()).request().input('id',sql.Int,req.params.id)
    .query('UPDATE OrgUnits SET IsActive=0 WHERE UnitID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// ══ إحصاء المنظمات الحقيقي (يُحسب الآن من المنظمات الفعلية المُدخلة وليس رقمًا يدويًا) ══
app.get('/api/stats/inspection',async(req,res)=>{try{
  const fromYear=parseInt(req.query.fromYear)||0;
  const toYear=parseInt(req.query.toYear)||9999;
  const database=await db();
  await ensureInspectionTable(database);
  const totals=await database.request().input('fy',sql.Int,fromYear).input('ty',sql.Int,toYear)
    .query(`SELECT COUNT(*) AS TotalReports, ISNULL(SUM(Revenue),0) AS TotalRevenue,
      ISNULL(SUM(Expenses),0) AS TotalExpenses, ISNULL(SUM(ClosingBalance),0) AS TotalClosingBalance
      FROM InspectionReports WHERE ISNULL(IsDeleted,0)=0 AND YearFrom<=@ty AND YearTo>=@fy`);
  const list=await database.request().input('fy',sql.Int,fromYear).input('ty',sql.Int,toYear)
    .query(`SELECT ir.ReportID,o.OrgID,o.OrgName,o.RegNum,o.RegYear,o.Governorate,
      ir.Scope,ir.YearFrom,ir.YearTo,ir.AuditorName,ir.OpeningBalance,ir.Revenue,ir.Expenses,ir.ClosingBalance
      FROM InspectionReports ir JOIN Organizations o ON ir.OrgID=o.OrgID
      WHERE ISNULL(ir.IsDeleted,0)=0 AND ir.YearFrom<=@ty AND ir.YearTo>=@fy
      ORDER BY ir.YearFrom DESC,ir.ReportID DESC`);
  res.json({totals:totals.recordset[0],list:list.recordset});
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/stats/organizations',async(req,res)=>{try{
  const{fromYear,toYear}=req.query;
  const d=await db();const r=d.request();
  let where='WHERE e.IsActive=1 AND u.IsActive=1';
  if(fromYear){where+=' AND e.EventYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
  if(toYear){where+=' AND e.EventYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
  const totals=await r.query(`SELECT
    COUNT(DISTINCT e.OrgEntryID) AS EntriesCount,
    COUNT(DISTINCT e.OrgID) AS OrgsInvolved,
    COUNT(u.UnitID) AS TotalOrgs,
    SUM(CASE WHEN u.LicenseRenewed=1 THEN 1 ELSE 0 END) AS RenewedOrgs,
    SUM(CASE WHEN u.LicenseAmended=1 THEN 1 ELSE 0 END) AS AmendedOrgs
    FROM OrgGeneralEntries e JOIN OrgUnits u ON u.OrgEntryID=e.OrgEntryID
    ${where}`);

  const yearParams=(rq)=>{ if(fromYear)rq.input('fy2',sql.Int,parseInt(fromYear)); if(toYear)rq.input('ty2',sql.Int,parseInt(toYear)); return rq; };
  const yearWhere=(fromYear?' AND e.EventYear>=@fy2':'')+(toYear?' AND e.EventYear<=@ty2':'');

  const byActivity=await yearParams(d.request()).query(`SELECT a.ActivityName AS Name, COUNT(DISTINCT u.UnitID) AS OrgCount
    FROM OrgUnitActivities a JOIN OrgUnits u ON a.UnitID=u.UnitID JOIN OrgGeneralEntries e ON u.OrgEntryID=e.OrgEntryID
    WHERE e.IsActive=1 AND u.IsActive=1 ${yearWhere}
    GROUP BY a.ActivityName ORDER BY OrgCount DESC`);

  const byPurpose=await yearParams(d.request()).query(`SELECT ISNULL(u.Purpose,N'غير محدد') AS Name, COUNT(*) AS OrgCount
    FROM OrgUnits u JOIN OrgGeneralEntries e ON u.OrgEntryID=e.OrgEntryID
    WHERE e.IsActive=1 AND u.IsActive=1 ${yearWhere}
    GROUP BY u.Purpose ORDER BY OrgCount DESC`);

  const byNationality=await yearParams(d.request()).query(`SELECT ISNULL(u.Nationality,N'غير محدد') AS Name, COUNT(*) AS OrgCount
    FROM OrgUnits u JOIN OrgGeneralEntries e ON u.OrgEntryID=e.OrgEntryID
    WHERE e.IsActive=1 AND u.IsActive=1 ${yearWhere}
    GROUP BY u.Nationality ORDER BY OrgCount DESC`);

  // أكثر الجمعيات لديها منظمات مسجّلة
  const byOrg=await yearParams(d.request()).query(`SELECT o.OrgName, o.RegNum, o.RegYear, COUNT(u.UnitID) AS UnitsCount
    FROM OrgUnits u JOIN OrgGeneralEntries e ON u.OrgEntryID=e.OrgEntryID JOIN Organizations o ON e.OrgID=o.OrgID
    WHERE e.IsActive=1 AND u.IsActive=1 ${yearWhere}
    GROUP BY o.OrgName,o.RegNum,o.RegYear ORDER BY UnitsCount DESC`);

  // (جديد) نفس الفكرة لكن سجل لكل منظمة على حدة (مش مجمَّعة) - ده اللي بيسمح بزر
  // "حذف بيانات إدارية" لكل منظمة بعينها من شاشة الإحصاء، بنفس فكرة باقي الإدارات
  // ── إصلاح جذري (v25): ضفنا e.EventMonth, e.EventYear (شهر/سنة التسجيل الفعلي) -
  // كان موجود أصلاً في جدول OrgGeneralEntries المربوط بالفعل، بس مش متسحَب هنا،
  // فمكانش فيه أي "تاريخ" نقدر نرتّب أو نعرض بيه إحصاء تسجيل المنظمات.
  const byUnit=await yearParams(d.request()).query(`SELECT u.UnitID,o.OrgID,o.OrgName,o.RegNum,o.RegYear,o.Governorate,
    u.UnitName,u.Nationality,u.Purpose,u.LicenseRenewed,u.LicenseAmended,e.EventMonth,e.EventYear
    FROM OrgUnits u JOIN OrgGeneralEntries e ON u.OrgEntryID=e.OrgEntryID JOIN Organizations o ON e.OrgID=o.OrgID
    WHERE e.IsActive=1 AND u.IsActive=1 ${yearWhere}
    ORDER BY o.OrgName`);

  // توزيع حسب المحافظة (محافظة الجمعية المسجَّل تحتها المنظمة)
  const byGovernorate=await yearParams(d.request()).query(`SELECT ISNULL(o.Governorate,N'غير محدد') AS Governorate, COUNT(u.UnitID) AS OrgCount
    FROM OrgUnits u JOIN OrgGeneralEntries e ON u.OrgEntryID=e.OrgEntryID JOIN Organizations o ON e.OrgID=o.OrgID
    WHERE e.IsActive=1 AND u.IsActive=1 ${yearWhere}
    GROUP BY o.Governorate ORDER BY OrgCount DESC`);

  res.json({
    totals:totals.recordset[0]||{EntriesCount:0,OrgsInvolved:0,TotalOrgs:0,RenewedOrgs:0,AmendedOrgs:0},
    byActivity:byActivity.recordset,
    byPurpose:byPurpose.recordset,
    byNationality:byNationality.recordset,
    byOrg:byOrg.recordset,
    byUnit:byUnit.recordset,
    byGovernorate:byGovernorate.recordset
  });
}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════
// ══ إحصاءات حقيقية لباقي الإدارات (كانت أرقام ثابتة وهمية في صفحة الإحصاء الإداري
//    وتم استبدالها بالكامل بأرقام حقيقية من قاعدة البيانات) ══
// ══════════════════════════════════════════════════

app.get('/api/stats/grants',async(req,res)=>{try{
  const{fromYear,toYear}=req.query;
  const d=await db();const r=d.request();
  let where='WHERE ISNULL(IsDeleted,0)=0';
  if(fromYear){where+=' AND GrantYear>=@fy';r.input('fy',sql.Int,parseInt(fromYear));}
  if(toYear){where+=' AND GrantYear<=@ty';r.input('ty',sql.Int,parseInt(toYear));}
  const totals=await r.query(`SELECT
    COUNT(DISTINCT OrgID) AS OrgsWithGrants,
    COUNT(*) AS TotalGrants,
    SUM(CASE WHEN GrantType=N'محلية' THEN 1 ELSE 0 END) AS LocalGrants,
    SUM(CASE WHEN GrantType=N'دولية' THEN 1 ELSE 0 END) AS InternationalGrants,
    ISNULL(SUM(Amount),0) AS TotalAmount
    FROM Grants ${where}`);
  const byType=await d.request().query(`SELECT ISNULL(GrantType,N'غير محدد') AS Name, COUNT(*) AS Count
    FROM Grants WHERE ISNULL(IsDeleted,0)=0 GROUP BY GrantType ORDER BY Count DESC`);
  // ── (جديد) قائمة تفصيلية بالجمعيات صاحبة المنح - نفس فكرة جدول التراخيص في جمع المال،
  // عشان ميفضلش الإحصاء رقم مجرد من غير معرفة هو خاص بأنهي جمعيات بالظبط ──
  const rList=d.request();
  if(fromYear)rList.input('fy',sql.Int,parseInt(fromYear));
  if(toYear)rList.input('ty',sql.Int,parseInt(toYear));
  const listWhere=where.replace(/(^|\s)(GrantYear|IsDeleted)/g,'$1g.$2');
  const list=await rList.query(`SELECT g.GrantID,o.OrgID,o.OrgName,o.RegNum,o.RegYear,o.Governorate,
    g.GrantName,g.GrantNumber,g.GrantType,g.Amount,g.GrantYear,g.Notes,g.CreatedAt
    FROM Grants g JOIN Organizations o ON g.OrgID=o.OrgID ${listWhere} ORDER BY g.GrantYear DESC,o.OrgName`);
  res.json({totals:totals.recordset[0],byType:byType.recordset,list:list.recordset});
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/stats/projects',async(req,res)=>{try{
  const d=await db();
  const totals=await d.request().query(`SELECT
    COUNT(DISTINCT OrgID) AS OrgsWithProjects,
    SUM(CASE WHEN IsAssigned=1 THEN ISNULL(Count,1) ELSE 0 END) AS AssignedProjects,
    SUM(ISNULL(Count,1)) AS TotalProjects
    FROM Projects WHERE ISNULL(IsDeleted,0)=0`);
  const byType=await d.request().query(`SELECT ISNULL(ProjectType,N'غير محدد') AS Name, SUM(ISNULL(Count,1)) AS Count
    FROM Projects WHERE ISNULL(IsDeleted,0)=0 GROUP BY ProjectType ORDER BY Count DESC`);
  const list=await d.request().query(`SELECT p.ProjectID,o.OrgID,o.OrgName,o.RegNum,o.RegYear,o.Governorate,
    p.ProjectType,p.IsAssigned,p.Count,p.Notes,p.CreatedAt
    FROM Projects p JOIN Organizations o ON p.OrgID=o.OrgID WHERE ISNULL(p.IsDeleted,0)=0 ORDER BY o.OrgName`);
  res.json({totals:totals.recordset[0],byType:byType.recordset,list:list.recordset});
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/stats/legislations',async(req,res)=>{try{
  const{fromDate,toDate}=req.query;
  // كل نوع قرار (حل الجمعية/إيقاف/تشكيل لجان/مجلس مؤقت/مخصص) له تاريخ قرار فعلي بيتسجَّل من الواجهة
  // (خانة التاريخ ظاهرة لكل الأنواع في الفورم - الحقل اللي بيتخفي لـ"حل الجمعية" هو رقم القرار بس).
  // فبالتالي إحصاء الفترة بيتحسب لأي قرار حسب تاريخه الفعلي (DecreeDate) بدون استثناء لأي نوع.
  // ملحوظة: شرط عدم التكرار (حل الجمعية ميتكررش خالص لنفس الجمعية بغض النظر عن التاريخ ومالوش رقم قرار
  // من الأساس؛ باقي الأنواع ميتكررش نفس الرقم في نفس التاريخ) منفصل تمامًا عن ده، ومتحقَّق في
  // POST/PUT /api/legislations - مش هنا في الإحصاء.
  const d=await db();const r=d.request();
  let where='WHERE ISNULL(IsDeleted,0)=0';
  if(fromDate){where+=' AND DecreeDate>=@fd';r.input('fd',sql.Date,fromDate);}
  if(toDate){where+=' AND DecreeDate<=@td';r.input('td',sql.Date,toDate);}
  const totals=await r.query(`SELECT
    COUNT(*) AS TotalDecrees,
    SUM(CASE WHEN DecreeType=N'حل الجمعية' THEN 1 ELSE 0 END) AS DissolveDecrees,
    SUM(CASE WHEN DecreeType=N'إيقاف' THEN 1 ELSE 0 END) AS SuspendDecrees,
    SUM(CASE WHEN DecreeType=N'تشكيل لجان' THEN 1 ELSE 0 END) AS CommitteeDecrees,
    SUM(CASE WHEN DecreeType=N'مجلس مؤقت' THEN 1 ELSE 0 END) AS TempBoardDecrees,
    SUM(CASE WHEN DecreeType=N'حل مجلس الادارة' THEN 1 ELSE 0 END) AS TempBoardDissolveDecrees,
    SUM(CASE WHEN DecreeType NOT IN(N'حل الجمعية',N'إيقاف',N'تشكيل لجان',N'مجلس مؤقت',N'حل مجلس الادارة') THEN 1 ELSE 0 END) AS OtherDecrees
    FROM Legislations ${where}`);
  const r2=d.request();
  if(fromDate)r2.input('fd',sql.Date,fromDate);
  if(toDate)r2.input('td',sql.Date,toDate);
  const byType=await r2.query(`SELECT ISNULL(DecreeType,N'غير محدد') AS Name, COUNT(*) AS Count
    FROM Legislations ${where} GROUP BY DecreeType ORDER BY Count DESC`);
  const rList=d.request();
  if(fromDate)rList.input('fd',sql.Date,fromDate);
  if(toDate)rList.input('td',sql.Date,toDate);
  const listWhere=where.replace(/(^|\s)(DecreeType|DecreeDate|IsDeleted)/g,'$1l.$2');
  const list=await rList.query(`SELECT l.LegID,o.OrgID,o.OrgName,o.RegNum,o.RegYear,o.Governorate,
    l.DecreeType,l.DecreeNumber,l.DecreeDate,l.Notes,l.CreatedAt
    FROM Legislations l JOIN Organizations o ON l.OrgID=o.OrgID ${listWhere} ORDER BY l.DecreeDate DESC,l.LegID DESC`);
  res.json({totals:totals.recordset[0],byType:byType.recordset,list:list.recordset});
}catch(e){res.status(500).json({error:e.message});}});

app.get('/api/stats/banned',async(req,res)=>{try{
  const{fromDate,toDate}=req.query;
  const d=await db();const r=d.request();
  let where='WHERE ISNULL(IsDeleted,0)=0';
  if(fromDate){where+=' AND DecreeDate>=@fd';r.input('fd',sql.Date,fromDate);}
  if(toDate){where+=' AND DecreeDate<=@td';r.input('td',sql.Date,toDate);}
  const totals=await r.query(`SELECT
    COUNT(*) AS TotalBanned,
    SUM(CASE WHEN FundsConfiscated=1 THEN 1 ELSE 0 END) AS FundsConfiscated,
    SUM(CASE WHEN HasCase=1 THEN 1 ELSE 0 END) AS HasCase,
    SUM(CASE WHEN DissolutionStatus=1 THEN 1 ELSE 0 END) AS Dissolving
    FROM BannedOrgs ${where}`);
  const r2=d.request();
  if(fromDate)r2.input('fd',sql.Date,fromDate);
  if(toDate)r2.input('td',sql.Date,toDate);
  const byStatus=await r2.query(`SELECT
    N'تحفظ على أموال' AS Name, SUM(CASE WHEN FundsConfiscated=1 THEN 1 ELSE 0 END) AS Count FROM BannedOrgs ${where}
    UNION ALL SELECT N'لديها قضايا', SUM(CASE WHEN HasCase=1 THEN 1 ELSE 0 END) FROM BannedOrgs ${where}
    UNION ALL SELECT N'جاري الحل', SUM(CASE WHEN DissolutionStatus=1 THEN 1 ELSE 0 END) FROM BannedOrgs ${where}
    UNION ALL SELECT N'موقوفة', SUM(CASE WHEN IsSuspended=1 THEN 1 ELSE 0 END) FROM BannedOrgs ${where}`);
  const rList=d.request();
  if(fromDate)rList.input('fd',sql.Date,fromDate);
  if(toDate)rList.input('td',sql.Date,toDate);
  const listWhere=where.replace(/(^|\s)(DecreeDate|IsDeleted)/g,'$1b.$2');
  const list=await rList.query(`SELECT b.BanID,o.OrgID,o.OrgName,o.RegNum,o.RegYear,o.Governorate,
    b.CaseNumber,b.DecreeNumber,b.DecreeDate,b.FundsConfiscated,b.HasCase,b.IsSuspended,b.DissolutionStatus,b.Notes,b.CreatedAt
    FROM BannedOrgs b JOIN Organizations o ON b.OrgID=o.OrgID ${listWhere} ORDER BY b.DecreeDate DESC`);
  res.json({totals:totals.recordset[0],byStatus:byStatus.recordset,list:list.recordset});
}catch(e){res.status(500).json({error:e.message});}});

// ══════════════════════════════════════════════════════════════════
// ══ أعضاء مجلس الإدارة (BoardMembers) ══
// - التسجيل باللصق الجماعي (زي اللصق على إكسيل) وليس خانة خانة
// - الرقم القومي إجباري وبالظبط 14 رقم لو الشخص ده رئيس المجلس
// - تصدير إكسيل (CSV بترميز UTF-8 عشان يفتح صح بالعربي)
// - البحث عن تكرار رقم قومي معيّن عبر كل الجمعيات
// ══════════════════════════════════════════════════════════════════

app.get('/api/board-members/:orgId',async(req,res)=>{try{
  const id=parseInt(req.params.orgId)||0;
  const r=await(await db()).request().input('id',sql.Int,id)
    .query(`SELECT* FROM BoardMembers WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0
      ORDER BY IsChairman DESC, FullName`);
  res.json(r.recordset);
}catch(e){res.status(500).json({error:e.message});}});

// تسجيل جماعي - الواجهة بترسل مصفوفة صفوف جاهزة (بعد ما المستخدم يلصق من إكسيل ويتقسّم بالتاب/الأسطر)
// كل صف: {FullName, NationalID, Position, Phone, IsChairman}
// ملحوظة: ده "upsert" مش "insert" بس - لو الرقم القومي المُلصَق موجود بالفعل لعضو نشط في نفس
// الجمعية، بنُحدِّث بياناته (الاسم/الوظيفة/التليفون/رئيس المجلس) بدل ما نضيف صف مكرر. ده بيسمح
// باستخدام نفس خانة اللصق لتعديل بيانات عضو موجود (زي تعديل تليفون رئيس المجلس) مش بس لإضافة جدد.
app.post('/api/board-members/bulk',async(req,res)=>{try{
  const permChk=assertCanManageOrg(req.user);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const{OrgID,Rows}=req.body;
  const oid=parseInt(OrgID);
  if(!oid) return res.status(400).json({error:'الجمعية غير محددة'});
  if(!Array.isArray(Rows)||!Rows.length) return res.status(400).json({error:'لا يوجد صفوف لتسجيلها'});

  const isValidNationalID=v=>!!v && /^\d{14}$/.test(String(v).trim());
  const errors=[];
  Rows.forEach((row,i)=>{
    const rn=(i+1);
    if(!row.FullName||!String(row.FullName).trim()) errors.push(`الصف ${rn}: الاسم إجباري`);
    if(!row.NationalID||!String(row.NationalID).trim()) errors.push(`الصف ${rn}: الرقم القومي إجباري لكل عضو`);
    else if(!isValidNationalID(row.NationalID)) errors.push(`الصف ${rn}: الرقم القومي لازم يكون 14 رقم بالظبط`);
  });
  if(errors.length) return res.status(400).json({error:errors.join(' - ')});

  const conn=await db();
  let inserted=0, updated=0;
  for(const row of Rows){
    const nid=row.NationalID?String(row.NationalID).trim():null;
    let existingId=null;
    if(nid){
      const ex=await conn.request().input('oid',sql.Int,oid).input('ni',sql.Char(14),nid)
        .query('SELECT TOP 1 MemberID FROM BoardMembers WHERE OrgID=@oid AND NationalID=@ni AND ISNULL(IsDeleted,0)=0');
      if(ex.recordset.length) existingId=ex.recordset[0].MemberID;
    }
    if(existingId){
      await conn.request().input('id',sql.Int,existingId)
        .input('nm',sql.NVarChar,String(row.FullName).trim())
        .input('ps',sql.NVarChar,row.Position||null).input('ph',sql.NVarChar,row.Phone||null)
        .input('ic',sql.Bit,row.IsChairman?1:0)
        .query(`UPDATE BoardMembers SET FullName=@nm,Position=@ps,Phone=@ph,IsChairman=@ic WHERE MemberID=@id`);
      updated++;
    } else {
      await conn.request()
        .input('oid',sql.Int,oid).input('nm',sql.NVarChar,String(row.FullName).trim())
        .input('ni',sql.Char(14),nid)
        .input('ps',sql.NVarChar,row.Position||null).input('ph',sql.NVarChar,row.Phone||null)
        .input('ic',sql.Bit,row.IsChairman?1:0).input('by',sql.Int,req.user.id)
        .query(`INSERT INTO BoardMembers(OrgID,FullName,NationalID,Position,Phone,IsChairman,CreatedBy)
          VALUES(@oid,@nm,@ni,@ps,@ph,@ic,@by)`);
      inserted++;
    }
  }
  // نحدّث اسم رئيس المجلس في البيانات الثابتة للجمعية تلقائيًا لو اتسجل/اتحدّث رئيس في الدفعة دي
  const chairman=Rows.find(r=>r.IsChairman);
  if(chairman){
    await conn.request().input('oid',sql.Int,oid).input('ch',sql.NVarChar,String(chairman.FullName).trim())
      .query('UPDATE Organizations SET Chairman=@ch WHERE OrgID=@oid');
  }
  res.json({ok:true,inserted,updated});
}catch(e){res.status(500).json({error:e.message});}});

// تعديل بيانات عضو واحد بشكل مباشر (اسم/رقم قومي/وظيفة/تليفون/رئيس؟) - يُستخدم من صف قابل
// للتعديل في الجدول (بدل الاعتماد فقط على اللصق الجماعي)
app.put('/api/board-members/:id',async(req,res)=>{try{
  const permChk=assertCanManageOrg(req.user);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const id=parseInt(req.params.id);
  if(!id) return res.status(400).json({error:'العضو غير محدد'});
  const{FullName,NationalID,Position,Phone,IsChairman}=req.body;
  if(!FullName||!String(FullName).trim()) return res.status(400).json({error:'الاسم إجباري'});
  const nid=NationalID?String(NationalID).trim():null;
  if(!nid) return res.status(400).json({error:'الرقم القومي إجباري لكل عضو'});
  if(!/^\d{14}$/.test(nid)) return res.status(400).json({error:'الرقم القومي لازم يكون 14 رقم بالظبط'});
  const conn=await db();
  const cur=await conn.request().input('id',sql.Int,id).query('SELECT OrgID FROM BoardMembers WHERE MemberID=@id AND ISNULL(IsDeleted,0)=0');
  if(!cur.recordset.length) return res.status(404).json({error:'العضو غير موجود'});
  const oid=cur.recordset[0].OrgID;
  await conn.request().input('id',sql.Int,id)
    .input('nm',sql.NVarChar,String(FullName).trim()).input('ni',sql.Char(14),nid)
    .input('ps',sql.NVarChar,Position||null).input('ph',sql.NVarChar,Phone||null)
    .input('ic',sql.Bit,IsChairman?1:0)
    .query('UPDATE BoardMembers SET FullName=@nm,NationalID=@ni,Position=@ps,Phone=@ph,IsChairman=@ic WHERE MemberID=@id');
  if(IsChairman){
    await conn.request().input('oid',sql.Int,oid).input('ch',sql.NVarChar,String(FullName).trim())
      .query('UPDATE Organizations SET Chairman=@ch WHERE OrgID=@oid');
  }
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

app.delete('/api/board-members/:id',async(req,res)=>{try{
  const permChk=assertCanManageOrg(req.user);
  if(!permChk.ok) return res.status(403).json({error:permChk.error});
  const reason=(req.body&&req.body.reason||'').trim();
  if(!reason) return res.status(400).json({error:'سبب الحذف إجباري'});
  const id=parseInt(req.params.id);
  await(await db()).request().input('id',sql.Int,id).input('rs',sql.NVarChar,reason).input('by',sql.Int,req.user.id)
    .query('UPDATE BoardMembers SET IsDeleted=1,DeleteReason=@rs,DeletedBy=@by,DeletedAt=GETDATE() WHERE MemberID=@id');
  res.json({ok:true});
}catch(e){res.status(500).json({error:e.message});}});

// تصدير أعضاء مجلس إدارة جمعية واحدة كملف CSV (يفتح مباشرة في إكسيل) - زي زر تنزيل مستندات الجمعية
app.get('/api/board-members/:orgId/export',async(req,res)=>{try{
  const id=parseInt(req.params.orgId)||0;
  const r=await(await db()).request().input('id',sql.Int,id)
    .query(`SELECT FullName,NationalID,Position,Phone,IsChairman FROM BoardMembers
      WHERE OrgID=@id AND ISNULL(IsDeleted,0)=0 ORDER BY IsChairman DESC, FullName`);
  const header='الاسم,الرقم القومي,الوظيفة,التليفون,رئيس المجلس\r\n';
  const rows=r.recordset.map(m=>[
    (m.FullName||'').replace(/,/g,' '),(m.NationalID||''),(m.Position||'').replace(/,/g,' '),
    (m.Phone||''),(m.IsChairman?'نعم':'لا')
  ].join(',')).join('\r\n');
  const csv='\ufeff'+header+rows; // BOM عشان إكسيل يعرض العربي صح
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="board-members-${id}.csv"`);
  res.send(csv);
}catch(e){res.status(500).json({error:e.message});}});

// البحث عن تكرار رقم قومي معيّن عبر كل الجمعيات (يفتح قسم "بحث أعضاء مجلس إدارة")
app.get('/api/board-members/search/by-national-id/:nationalId',async(req,res)=>{try{
  const nid=String(req.params.nationalId||'').trim();
  if(!/^\d{14}$/.test(nid)) return res.status(400).json({error:'الرقم القومي لازم يكون 14 رقم بالظبط'});
  const r=await(await db()).request().input('nid',sql.Char(14),nid)
    .query(`SELECT bm.MemberID,bm.FullName,bm.Position,bm.Phone,bm.IsChairman,
      o.OrgID,o.OrgName,o.RegNum,o.RegYear,o.Governorate,o.Status,o.DirFlagSuspended,o.DirFlagNote
      FROM BoardMembers bm JOIN Organizations o ON bm.OrgID=o.OrgID
      WHERE bm.NationalID=@nid AND ISNULL(bm.IsDeleted,0)=0 AND ISNULL(o.IsActive,1)=1
      ORDER BY o.OrgName`);
  res.json({count:r.recordset.length,list:r.recordset});
}catch(e){res.status(500).json({error:e.message});}});

// ══ فحص تكرار قبل الموافقة على طلب إضافة جمعية - بيتنادى وهو المُراجِع لسه بيملى المستوى/السنة ══
app.get('/api/add-requests/:id/check-duplicate',async(req,res)=>{try{
  const{level,regYear,governorate}=req.query;
  const d=await db();
  const rq=await d.request().input('id',sql.Int,req.params.id).query('SELECT* FROM AddRequests WHERE ReqID=@id');
  if(!rq.recordset.length) return res.status(404).json({error:'الطلب غير موجود'});
  const r=rq.recordset[0];
  const regNum=parseInt(r.RegNum)||0;
  const ry=parseInt(regYear)||new Date().getFullYear();
  const lv=level||'مديرية'; // نفس افتراض مسار القبول (مديرية) عشان فحص التكرار يبقى متسق
  const gv=governorate||r.Governorate;
  // نفس قاعدة التكرار المستخدمة فعليًا في القبول (checkRegNumDuplicate):
  // مركزي بيتعارض بغض النظر عن السنة/المديرية، ومديرية بتتعارض بس لو نفس المديرية (بغض النظر عن السنة)
  const dupRow=await checkRegNumDuplicate(d,{rn:regNum,lv,gv});
  const sameRegNum=await d.request().input('rn',sql.Int,regNum)
    .query("SELECT OrgID,OrgName,RegYear,Level,Status,Governorate FROM Organizations WHERE RegNum=@rn AND ISNULL(IsActive,1)=1");
  const sameName=await d.request().input('nm',sql.NVarChar,'%'+(r.OrgName||'')+'%')
    .query("SELECT TOP 5 OrgID,OrgName,RegNum,RegYear,Level,Status FROM Organizations WHERE OrgName LIKE @nm AND ISNULL(IsActive,1)=1");
  res.json({
    exactMatch: dupRow||null,
    exactMatchMessage: dupRow?regNumDuplicateMessage(dupRow):null,
    sameRegNumOtherRecords: sameRegNum.recordset,
    similarNames: sameName.recordset
  });
}catch(e){res.status(500).json({error:e.message});}});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`\n✅ NGO System يعمل على http://localhost:${PORT}\n`));
