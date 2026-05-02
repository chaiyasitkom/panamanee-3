"""
LINE Bot Server — ระบบแจ้งซ่อมเครื่องจักร V11
- รับ webhook จาก LINE
- Push notification เมื่อมีแจ้งซ่อมใหม่ / อัปเดตสถานะ
- สรุปงานค้างซ่อมประจำวัน (08:00)
- API สำหรับสร้าง Firebase Auth user (Admin)
"""
import os, logging
from datetime import datetime
from functools import wraps
from waitress import serve

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler

from linebot.v3 import WebhookHandler
from linebot.v3.messaging import (
    Configuration, ApiClient, MessagingApi,
    PushMessageRequest, TextMessage, ReplyMessageRequest
)
from linebot.v3.webhooks import JoinEvent, MessageEvent, TextMessageContent
from linebot.v3.exceptions import InvalidSignatureError

import firebase_admin
from firebase_admin import credentials, firestore, auth as admin_auth

# ─────────────────────────────────────────
load_dotenv()
logging.basicConfig(level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.FileHandler('line_server.log', encoding='utf-8'), logging.StreamHandler()])
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins='*')

# ─── Firebase Admin SDK ───
try:
    cred = credentials.Certificate('serviceAccountKey.json')
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    logger.info("Firebase Admin SDK initialized")
except Exception as e:
    logger.error(f"Firebase init error: {e}")
    logger.error("กรุณาดาวน์โหลด serviceAccountKey.json จาก Firebase Console → Project Settings → Service Accounts")
    db = None

# ─── LINE Bot ───
LINE_CHANNEL_SECRET = os.getenv('LINE_CHANNEL_SECRET', '')
LINE_CHANNEL_ACCESS_TOKEN = os.getenv('LINE_CHANNEL_ACCESS_TOKEN', '')
line_config = Configuration(access_token=LINE_CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(LINE_CHANNEL_SECRET)

# ─────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────
def push_text(group_id: str, text: str):
    try:
        with ApiClient(line_config) as api_client:
            MessagingApi(api_client).push_message(
                PushMessageRequest(to=group_id, messages=[TextMessage(type='text', text=text)])
            )
    except Exception as e:
        logger.error(f"LINE push failed ({group_id}): {e}")

def get_groups_for_project(project: str):
    if not db: return []
    try:
        snap = db.collection('line_groups').where('project', '==', project).where('active', '==', True).stream()
        return [d.to_dict()['groupId'] for d in snap]
    except Exception as e:
        logger.error(f"get_groups error: {e}")
        return []

def get_all_groups():
    if not db: return []
    try:
        snap = db.collection('line_groups').where('active', '==', True).stream()
        return [d.to_dict()['groupId'] for d in snap]
    except Exception as e:
        logger.error(f"get_all_groups error: {e}")
        return []

def require_admin(f):
    """Decorator: ตรวจสอบ Firebase ID Token และ role=admin"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({'ok': False, 'error': 'Unauthorized'}), 401
        try:
            decoded = admin_auth.verify_id_token(token)
            uid = decoded['uid']
            user_doc = db.collection('users').doc(uid).get()
            if not user_doc.exists or user_doc.to_dict().get('role') != 'admin':
                return jsonify({'ok': False, 'error': 'Forbidden — admin only'}), 403
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)}), 401
        return f(*args, **kwargs)
    return decorated

# ─────────────────────────────────────────
# LINE WEBHOOK
# ─────────────────────────────────────────
@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Line-Signature', '')
    body = request.get_data(as_text=True)
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        logger.warning('Invalid LINE signature')
        return 'Bad request', 400
    except Exception as e:
        logger.error(f'Webhook error: {e}')
    return 'OK'

@handler.add(JoinEvent)
def on_join(event):
    src = event.source
    if hasattr(src, 'group_id'):
        gid = src.group_id
        logger.info(f"Bot joined group: {gid}")
        try:
            with ApiClient(line_config) as api_client:
                MessagingApi(api_client).reply_message(
                    ReplyMessageRequest(
                        reply_token=event.reply_token,
                        messages=[TextMessage(type='text',
                            text=f"สวัสดีครับ! ระบบแจ้งซ่อมเครื่องจักร V11 พร้อมแจ้งเตือนแล้ว\n\nGroup ID: {gid}\n\nนำ Group ID นี้ไปลงทะเบียนในระบบ Admin")]
                    )
                )
        except Exception as e:
            logger.error(f"Reply on join error: {e}")

# ─────────────────────────────────────────
# NOTIFICATION API
# ─────────────────────────────────────────
@app.route('/api/notify', methods=['POST'])
def notify():
    data = request.json or {}
    event = data.get('event')
    repair = data.get('repair', {})
    project = repair.get('project', '')
    rep_number = repair.get('repairNumber', '-')
    machine = repair.get('machine', '-')

    groups = get_groups_for_project(project) if project else get_all_groups()
    if not groups:
        logger.info(f"No LINE groups found for project '{project}'")
        return jsonify({'ok': True, 'sent': 0})

    text = None
    if event == 'new_repair':
        urgency_icon = {'ด่วนมาก': '🔴', 'ด่วน': '🟠', 'ปกติ': '🟢'}.get(repair.get('urgency', ''), '⚪')
        text = (
            f"🔧 แจ้งซ่อมใหม่ {urgency_icon}\n"
            f"เลขที่ : {rep_number}\n"
            f"โครงการ : {project}\n"
            f"เครื่องจักร : {machine}\n"
            f"อาการ : {repair.get('symptoms', '-')[:80]}\n"
            f"ระดับด่วน : {repair.get('urgency', '-')}\n"
            f"ผู้แจ้ง : {repair.get('reporterName', '-')}"
        )
    elif event == 'status_change':
        status_icon = {
            'กำลังตรวจสอบ': '🔍', 'กำลังซ่อม': '🔨',
            'รอชิ้นส่วน': '📦', 'เสร็จสิ้น': '✅', 'ยกเลิก': '❌'
        }.get(repair.get('status', ''), '🔄')
        text = (
            f"{status_icon} อัปเดตงานซ่อม\n"
            f"เลขที่ : {rep_number}\n"
            f"เครื่องจักร : {machine}\n"
            f"สถานะใหม่ : {repair.get('status', '-')}\n"
            f"โดย : {repair.get('updatedBy', '-')}\n"
            f"หมายเหตุ : {repair.get('note', '-')}"
        )

    if text:
        for gid in groups:
            push_text(gid, text)
        logger.info(f"Sent '{event}' to {len(groups)} group(s) for '{project}'")

    return jsonify({'ok': True, 'sent': len(groups)})

# ─────────────────────────────────────────
# ADMIN API — CREATE USER
# ─────────────────────────────────────────
@app.route('/api/admin/create-user', methods=['POST'])
@require_admin
def create_user():
    data = request.json or {}
    username = data.get('username', '').strip().lower()
    email = data.get('email', '').strip()
    password = data.get('password', '')
    display_name = data.get('displayName', '').strip()
    role = data.get('role', 'ผู้แจ้ง')

    if not username or not email or not password or not display_name:
        return jsonify({'ok': False, 'error': 'username, email, password, displayName required'}), 400
    if role not in ['admin', 'ช่าง', 'ช่างซ่อม', 'ผู้แจ้ง', 'ผู้บริหาร']:
        return jsonify({'ok': False, 'error': 'invalid role'}), 400
    if len(password) < 6:
        return jsonify({'ok': False, 'error': 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'}), 400

    # ตรวจ username ซ้ำ
    if db.collection('usernames').document(username).get().exists:
        return jsonify({'ok': False, 'error': 'username นี้มีอยู่ในระบบแล้ว'}), 409

    try:
        user = admin_auth.create_user(email=email, password=password, display_name=display_name)
        batch = db.batch()
        batch.set(db.collection('users').document(user.uid), {
            'email': email,
            'displayName': display_name,
            'role': role,
            'disabled': False,
            'createdAt': firestore.SERVER_TIMESTAMP
        })
        batch.set(db.collection('usernames').document(username), {
            'email': email,
            'uid': user.uid
        })
        batch.commit()
        logger.info(f"Created user {email} username={username} ({role}) uid={user.uid}")
        return jsonify({'ok': True, 'uid': user.uid})
    except admin_auth.EmailAlreadyExistsError:
        return jsonify({'ok': False, 'error': 'อีเมลนี้มีอยู่ในระบบแล้ว'}), 409
    except Exception as e:
        logger.error(f"create_user error: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500

# ─────────────────────────────────────────
# DAILY SUMMARY SCHEDULER
# ─────────────────────────────────────────
def daily_summary():
    if not db:
        logger.warning("DB not initialized, skipping daily summary")
        return
    try:
        pending_statuses = ['รอดำเนินการ', 'กำลังตรวจสอบ', 'กำลังซ่อม', 'รอชิ้นส่วน']
        all_pending = []
        for status in pending_statuses:
            snap = db.collection('repairs').where('status', '==', status).stream()
            all_pending.extend([d.to_dict() for d in snap])

        if not all_pending:
            logger.info("Daily summary: no pending repairs")
            return

        by_proj = {}
        for r in all_pending:
            p = r.get('project', 'ไม่ระบุ')
            by_proj.setdefault(p, []).append(r)

        today = datetime.now().strftime('%d/%m/%Y')
        msg = f"📋 สรุปงานค้างซ่อม ประจำวัน {today}\nรวมทั้งหมด: {len(all_pending)} รายการ\n"

        for proj, items in by_proj.items():
            msg += f"\n📍 {proj}: {len(items)} รายการ"
            urgent = [r for r in items if r.get('urgency') == 'ด่วนมาก']
            if urgent:
                msg += f" (🔴 ด่วนมาก {len(urgent)} รายการ)"
            msg += '\n'
            for r in items[:3]:
                icon = {'ด่วนมาก': '🔴', 'ด่วน': '🟠', 'ปกติ': '🟢'}.get(r.get('urgency', ''), '⚪')
                msg += f"  {icon} {r.get('machine','-')} [{r.get('status','-')}]\n"
            if len(items) > 3:
                msg += f"  ...และอื่นๆ อีก {len(items)-3} รายการ\n"

        for gid in get_all_groups():
            push_text(gid, msg.strip())
        logger.info(f"Daily summary sent: {len(all_pending)} pending repairs to {len(get_all_groups())} groups")
    except Exception as e:
        logger.error(f"daily_summary error: {e}")

# ─────────────────────────────────────────
if __name__ == '__main__':
    scheduler = BackgroundScheduler(timezone='Asia/Bangkok')
    scheduler.add_job(daily_summary, 'cron', hour=8, minute=0, id='daily_summary')
    scheduler.start()
    logger.info("Scheduler started — daily summary at 08:00")

    port = int(os.getenv('LINE_SERVER_PORT', 5001))
    logger.info(f"LINE Server V11 starting at http://0.0.0.0:{port}")
    serve(app, host='0.0.0.0', port=port, threads=4)
