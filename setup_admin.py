"""
สร้าง admin user ครั้งแรก — รันครั้งเดียว แล้วลบทิ้ง
  user     : admin
  password : komdevil99
  role     : admin
"""
import firebase_admin
from firebase_admin import credentials, firestore, auth as admin_auth

cred = credentials.Certificate('serviceAccountKey.json')
firebase_admin.initialize_app(cred)

USERNAME    = 'admin'
EMAIL       = 'admin@panamanee.local'
PASSWORD    = 'komdevil99'
DISPLAY     = 'Administrator'
ROLE        = 'admin'

# ─── STEP 1: สร้าง / ดึง Firebase Auth user ───
try:
    user = admin_auth.create_user(
        email=EMAIL,
        password=PASSWORD,
        display_name=DISPLAY
    )
    print(f"[OK] สร้าง Firebase Auth user สำเร็จ  uid={user.uid}")
except admin_auth.EmailAlreadyExistsError:
    user = admin_auth.get_user_by_email(EMAIL)
    print(f"[INFO] Firebase Auth user มีอยู่แล้ว  uid={user.uid}")
except Exception as e:
    print(f"[ERROR] สร้าง Auth user ไม่สำเร็จ: {e}")
    raise SystemExit(1)

# ─── STEP 2: เขียน Firestore ───
try:
    db = firestore.client()

    # ตรวจ username ซ้ำ
    existing = db.collection('usernames').document(USERNAME).get()
    if existing.exists and existing.to_dict().get('uid') == user.uid:
        print(f"[SKIP] username '{USERNAME}' ตั้งค่าครบแล้ว")
    else:
        batch = db.batch()
        batch.set(db.collection('users').document(user.uid), {
            'email':       EMAIL,
            'displayName': DISPLAY,
            'role':        ROLE,
            'disabled':    False,
            'createdAt':   firestore.SERVER_TIMESTAMP
        }, merge=True)
        batch.set(db.collection('usernames').document(USERNAME), {
            'email': EMAIL,
            'uid':   user.uid
        })
        batch.commit()
        print(f"[OK] เขียน Firestore สำเร็จ")

    print()
    print(f"  username : {USERNAME}")
    print(f"  password : {PASSWORD}")
    print(f"  email    : {EMAIL}")
    print(f"  role     : {ROLE}")
    print(f"  uid      : {user.uid}")
    print()
    print(">>> ลบไฟล์ setup_admin.py ทิ้งหลังใช้งานแล้ว <<<")

except Exception as e:
    print()
    print(f"[ERROR] Firestore: {e}")
    print()
    print("Firestore ยังไม่ได้สร้าง — กรุณาไปที่:")
    print("  Firebase Console → Firestore Database → Create database")
    print(f"  https://console.firebase.google.com/project/panamanee-3a15a/firestore")
    print()
    print(f"Firebase Auth user ถูกสร้างแล้ว uid={user.uid}")
    print("หลังสร้าง Firestore แล้ว รันสคริปต์นี้อีกครั้ง")
