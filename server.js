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
// VNPAY
const VNPAY_SECRET = "S9HTHYBJ2L9U2JPVYCDOBFALPZANZ8JU";

// PAYPAL SANDBOX (Đã lắp mã chính chủ của anh vào)
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "AT3enJIsL1ZVB8tRT5_UTCc-Ht-ZZ07tYr2dmnoXRGq5goM522dfmqQ5CGKOKL3F31YRLifECxxQUC3T";
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || "EOIkyHb8XNBrR3v4lBHJLGEiPa02MMd-D9-pHvWYTMwxW6XMsfXCkvr4Sq8NZiOboHob7F6-MHoFkwQU";
const PAYPAL_API = "https://api-m.sandbox.paypal.com";


// ==========================================
// 🚀 TRẠM TRUNG CHUYỂN DÙNG CHUNG CHO CÁC CỔNG
// ==========================================
app.get('/vnpay-return', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><title>Đang về App...</title></head>
        <body style="text-align: center; padding-top: 50px; font-family: sans-serif; background: #fce4ec; color: #d82d8b;">
            <h2>Giao dịch hoàn tất!</h2>
            <p>Hệ thống đang tự động đưa sếp về lại Monica Wallet...</p>
            <script>setTimeout(() => { window.location.href = "monicawallet://"; }, 1000);</script>
        </body></html>
    `);
});

// ==========================================
// 🇻🇳 CỔNG VNPAY (GIỮ NGUYÊN)
// ==========================================
app.get('/vnpay-ipn', async (req, res) => {
    try {
        let vnp_Params = { ...req.query };
        let secureHash = vnp_Params['vnp_SecureHash'];
        delete vnp_Params['vnp_SecureHash'];
        delete vnp_Params['vnp_SecureHashType'];

        let sortedKeys = Object.keys(vnp_Params).sort();
        let signData = "";
        sortedKeys.forEach((key, index) => {
            if (vnp_Params[key] !== '' && vnp_Params[key] !== undefined && vnp_Params[key] !== null) {
                const val = encodeURIComponent(vnp_Params[key].toString()).replace(/%20/g, '+');
                signData += key + '=' + val;
                if (index < sortedKeys.length - 1) signData += '&';
            }
        });

        let hmac = crypto.createHmac("sha512", VNPAY_SECRET);
        let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");

        if (secureHash === signed) {
            if (vnp_Params['vnp_ResponseCode'] === '00') {
                let username = vnp_Params['vnp_OrderInfo'].split('_')[1]; 
                await db.collection('users').doc(username).update({ isPremium: true });
                res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
            } else {
                res.status(200).json({ RspCode: '00', Message: 'Success' });
            }
        } else {
            res.status(200).json({ RspCode: '97', Message: 'Fail checksum' });
        }
    } catch (error) { res.status(500).json({ RspCode: '99', Message: 'Unknown error' }); }
});

// ==========================================
// 🇺🇸 CỔNG PAYPAL (MỚI ĐÉT)
// ==========================================

// 1. Tạo hóa đơn PayPal (Thu 80 USD ~ 2 Triệu VNĐ)
app.get('/paypal-pay', async (req, res) => {
    const username = req.query.username;
    try {
        // Mã hóa khóa bảo mật
        const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
        
        // Gọi lên PayPal xin cái Token
        const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
            method: 'POST',
            body: 'grant_type=client_credentials',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const tokenData = await tokenRes.json();

        // Tạo hóa đơn thu 80 đô
        const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                intent: "CAPTURE",
                purchase_units: [{ reference_id: username, amount: { currency_code: "USD", value: "80.00" } }],
                application_context: {
                    return_url: `https://monica-server-u9ko.onrender.com/paypal-return?username=${username}`,
                    cancel_url: `https://monica-server-u9ko.onrender.com/vnpay-return` 
                }
            })
        });
        
        const orderData = await orderRes.json();
        const approveLink = orderData.links.find(link => link.rel === 'approve').href;
        
        // Đá khách hàng văng thẳng sang trình duyệt để đăng nhập PayPal
        res.redirect(approveLink);
    } catch (error) {
        console.error("Lỗi PayPal Pay:", error);
        res.send("Đang bảo trì cổng quốc tế, anh quay lại sau nhé!");
    }
});

// 2. Trạm bắt kết quả sau khi khách quẹt PayPal xong
app.get('/paypal-return', async (req, res) => {
    const { token, username } = req.query; // Token này là ID của hóa đơn
    try {
        const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
        const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
            method: 'POST', body: 'grant_type=client_credentials',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const tokenData = await tokenRes.json();

        // Ra lệnh "Chốt đơn - Thu tiền"
        const captureRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${token}/capture`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' }
        });
        const captureData = await captureRes.json();

        if (captureData.status === 'COMPLETED') {
            // 🔥 THỌC VÀO FIREBASE BƠM VIP
            await db.collection('users').doc(username).update({ isPremium: true });
            console.log(`✅ PayPal: Đã nạp VIP thành công cho ${username}!`);
            
            // Hiện bảng báo cáo rồi giật ngược về App
            res.send(`
                <!DOCTYPE html>
                <html><head><meta charset="utf-8"><title>Thanh toán thành công</title></head>
                <body style="text-align: center; padding-top: 50px; font-family: sans-serif; background: #e0f7fa; color: #00796b;">
                    <h2>PayPal: Giao dịch 80 USD hoàn tất!</h2>
                    <p>Hệ thống đang tự động đưa anh về lại App...</p>
                    <script>setTimeout(() => { window.location.href = "monicawallet://"; }, 1500);</script>
                </body></html>
            `);
        } else {
            res.send("Thanh toán PayPal chưa hoàn tất hoặc bị từ chối!");
        }
    } catch (error) {
        console.error("Lỗi PayPal Return:", error);
        res.send("Có lỗi xảy ra khi xác nhận hóa đơn PayPal!");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Monica IPN đang chạy trên cổng ${PORT}`);
});
