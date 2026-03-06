const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');

// 1. KẾT NỐI FIREBASE (Sếp giữ nguyên két sắt trên Render là nó tự nhận)
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

// Khóa bảo mật Sandbox của sếp
const VNPAY_SECRET = "S9HTHYBJ2L9U2JPVYCDOBFALPZANZ8JU";

// TRẠM TRUNG CHUYỂN (Đá người dùng về App)
app.get('/vnpay-return', (req, res) => {
    const appLink = req.query.appLink;
    if (appLink) {
        let queryParams = new URLSearchParams(req.query);
        queryParams.delete('appLink'); 
        const finalLink = `${appLink}?${queryParams.toString()}`;

        res.send(`
            <!DOCTYPE html>
            <html><head><meta charset="utf-8"><title>Đang về App...</title></head>
            <body style="text-align: center; padding-top: 50px; font-family: sans-serif; background: #fce4ec; color: #d82d8b;">
                <h2>Giao dịch hoàn tất!</h2>
                <p>Hệ thống đang tự động đưa sếp về lại Monica Wallet...</p>
                <script>
                    setTimeout(() => { window.location.href = "${finalLink}"; }, 1000);
                </script>
            </body></html>
        `);
    } else {
        res.send("Thành công! Sếp tự vuốt về app nhé.");
    }
});

// CỔNG IPN BẮT HÓA ĐƠN TỪ VNPAY
app.get('/vnpay-ipn', async (req, res) => {
    try {
        let vnp_Params = { ...req.query };
        let secureHash = vnp_Params['vnp_SecureHash'];

        delete vnp_Params['vnp_SecureHash'];
        delete vnp_Params['vnp_SecureHashType'];

        // 🔥 THUẬT TOÁN ĐỒNG BỘ 100% VỚI APP REACT NATIVE 🔥
        let sortedKeys = Object.keys(vnp_Params).sort();
        let signData = "";
        
        sortedKeys.forEach((key, index) => {
            if (vnp_Params[key] !== '' && vnp_Params[key] !== undefined && vnp_Params[key] !== null) {
                const val = encodeURIComponent(vnp_Params[key].toString()).replace(/%20/g, '+');
                signData += key + '=' + val;
                if (index < sortedKeys.length - 1) {
                    signData += '&';
                }
            }
        });

        let hmac = crypto.createHmac("sha512", VNPAY_SECRET);
        let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");

        if (secureHash === signed) {
            let orderInfo = vnp_Params['vnp_OrderInfo']; 
            let responseCode = vnp_Params['vnp_ResponseCode'];

            if (responseCode === '00') {
                let username = orderInfo.split('_')[1]; 
                
                console.log(`[TING TING] Khách hàng ${username} đã thanh toán!`);
                console.log(`👉 Đang mở cổng Firebase bơm VIP...`);

                const userRef = db.collection('users').doc(username);
                await userRef.update({ isPremium: true });
                console.log(`✅ Nạp VIP thành công cho ${username}!`);

                res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
            } else {
                console.log('Khách đã hủy giao dịch!');
                res.status(200).json({ RspCode: '00', Message: 'Success' });
            }
        } else {
            console.log('🔴 Phát hiện giả mạo! Chữ ký không khớp.');
            res.status(200).json({ RspCode: '97', Message: 'Fail checksum' });
        }
    } catch (error) {
        console.error("Lỗi IPN:", error);
        res.status(500).json({ RspCode: '99', Message: 'Unknown error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Monica IPN đang chạy trên cổng ${PORT}`);
});
