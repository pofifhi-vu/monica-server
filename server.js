const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');

// 1. KẾT NỐI FIREBASE BẰNG KÉT SẮT RENDER
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
        })
    });
}
const db = admin.firestore();
const app = express();
app.use(express.json());

// ==========================================
// 🔥 KHU VỰC CẤU HÌNH CỔNG THANH TOÁN
// ==========================================
const VNPAY_SECRET = "S9HTHYBJ2L9U2JPVYCDOBFALPZANZ8JU";

// MÃ PAYPAL CỦA ANH
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "AT3enJIsL1ZVB8tRT5_UTCc-Ht-ZZ07tYr2dmnoXRGq5goM522dfmqQ5CGKOKL3F31YRLifECxxQUC3T";
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || "EOIkyHb8XNBrR3v4lBHJLGEiPa02MMd-D9-pHvWYTMwxW6XMsfXCkvr4Sq8NZiOboHob7F6-MHoFkwQU";
const PAYPAL_API = "https://api-m.sandbox.paypal.com";

// 🔥 DÁN 2 MÃ GÓI CƯỚC (PLAN ID) CỦA ANH VÀO ĐÂY 🔥
const PLAN_ID_1M = "P-0LM17154CJ386443KNGZKRXA"; // Gói 1 Tháng anh gửi nãy
const PLAN_ID_1Y = "P-72U18152DX6075930NGZKSUI"; // Gói 1 Năm anh gửi nãy

// ==========================================
// 🚀 TRẠM TRUNG CHUYỂN DÙNG CHUNG
// ==========================================
app.get('/vnpay-return', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><title>Đang về App...</title></head>
        <body style="text-align: center; padding-top: 50px; font-family: sans-serif; background: #fce4ec; color: #d82d8b;">
            <h2>Hoàn tất! Hệ thống đang đá anh về App...</h2>
            <script>setTimeout(() => { window.location.href = "monicawallet://"; }, 1500);</script>
        </body></html>
    `);
});

// ==========================================
// 🇻🇳 CỔNG VNPAY (TỰ ĐỘNG CỘNG 30 NGÀY / 365 NGÀY)
// ==========================================
app.get('/vnpay-ipn', async (req, res) => {
    try {
        let vnp_Params = { ...req.query };
        let secureHash = vnp_Params['vnp_SecureHash'];
        delete vnp_Params['vnp_SecureHash'];
        delete vnp_Params['vnp_SecureHashType'];

        let signData = Object.keys(vnp_Params).sort().map(key => {
            if (vnp_Params[key] !== '' && vnp_Params[key] !== undefined && vnp_Params[key] !== null) {
                return key + '=' + encodeURIComponent(vnp_Params[key].toString()).replace(/%20/g, '+');
            }
        }).filter(Boolean).join('&');

        let signed = crypto.createHmac("sha512", VNPAY_SECRET).update(Buffer.from(signData, 'utf-8')).digest("hex");

        if (secureHash === signed) {
            if (vnp_Params['vnp_ResponseCode'] === '00') {
                let orderInfo = vnp_Params['vnp_OrderInfo'];
                let pkgType = orderInfo.split('_')[0]; 
                let username = orderInfo.split('_')[1]; 

                const userRef = db.collection('users').doc(username);
                const userDoc = await userRef.get();
                
                let currentUntil = userDoc.data()?.premiumUntil || Date.now();
                if (currentUntil < Date.now()) currentUntil = Date.now();

                let timeToAdd = pkgType === 'VIP1Y' ? (365 * 24 * 60 * 60 * 1000) : (30 * 24 * 60 * 60 * 1000);
                await userRef.update({ isPremium: true, premiumUntil: currentUntil + timeToAdd });
                
                res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
            } else res.status(200).json({ RspCode: '00', Message: 'Success' });
        } else res.status(200).json({ RspCode: '97', Message: 'Fail checksum' });
    } catch (error) { res.status(500).json({ RspCode: '99', Message: 'Unknown error' }); }
});

// ==========================================
// 🇺🇸 CỔNG PAYPAL QUỐC TẾ (ĐĂNG KÝ THUÊ BAO)
// ==========================================

// 1. Tạo hợp đồng thuê bao
app.get('/paypal-subscribe', async (req, res) => {
    const { username, pkg } = req.query; 
    const selectedPlanId = pkg === '1Y' ? PLAN_ID_1Y : PLAN_ID_1M;

    try {
        const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
        const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
            method: 'POST', body: 'grant_type=client_credentials',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const tokenData = await tokenRes.json();

        const subRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan_id: selectedPlanId,
                custom_id: username, // Dán mác tên user để lát Webhook nhận diện
                application_context: {
                    brand_name: "Monica Wallet Premium",
                    user_action: "SUBSCRIBE_NOW",
                    return_url: `https://monica-server-u9ko.onrender.com/vnpay-return`,
                    cancel_url: `https://monica-server-u9ko.onrender.com/vnpay-return` 
                }
            })
        });
        
        const subData = await subRes.json();
        const approveLink = subData.links.find(link => link.rel === 'approve').href;
        
        res.redirect(approveLink);
    } catch (error) { 
        console.error("Lỗi PayPal Sub:", error);
        res.send("Đang bảo trì cổng quốc tế, anh quay lại sau nhé!"); 
    }
});

// 2. 📡 ĂNG-TEN WEBHOOK (NGHE LÉN PAYPAL TRỪ TIỀN)
app.post('/paypal-webhook', async (req, res) => {
    const event = req.body;
    console.log("🔔 WEBHOOK PHÁT HIỆN SỰ KIỆN:", event.event_type);

    if (event.event_type === 'PAYMENT.SALE.COMPLETED') {
        try {
            const custom_id = event.resource.custom; 
            const amount = parseFloat(event.resource.amount.total); 

            if (custom_id) {
                const userRef = db.collection('users').doc(custom_id);
                const userDoc = await userRef.get();
                
                let currentUntil = userDoc.data()?.premiumUntil || Date.now();
                if (currentUntil < Date.now()) currentUntil = Date.now();

                // Xác định gói vừa trừ tiền để cộng ngày
                let timeToAdd = amount > 50 ? (365 * 24 * 60 * 60 * 1000) : (30 * 24 * 60 * 60 * 1000);
                
                await userRef.update({ isPremium: true, premiumUntil: currentUntil + timeToAdd });
                console.log(`✅ [AUTO] Đã gia hạn VIP tự động cho ${custom_id}!`);
            }
        } catch (err) { console.error("Lỗi Webhook xử lý:", err); }
    }
    res.status(200).send('OK'); 
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Monica IPN đang chạy trên cổng ${PORT}`);
});
