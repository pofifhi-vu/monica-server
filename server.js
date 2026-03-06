const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());
// Trạm trung chuyển: Hứng người dùng từ VNPAY đá về, rồi ném ngược vào App
app.get('/vnpay-return', (req, res) => {
    const appLink = req.query.appLink;
    if (appLink) {
        // Gom lại mấy cái thông số hóa đơn của VNPAY gửi về
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
                    // Tự động đá về app sau 1 giây
                    setTimeout(() => { window.location.href = "${finalLink}"; }, 1000);
                </script>
            </body></html>
        `);
    } else {
        res.send("Thành công! Sếp tự vuốt về app nhé.");
    }
});
// Sếp giữ nguyên Secret Key này nhé
const VNPAY_SECRET = "S9HTHYBJ2L9U2JPVYCDOBFALPZANZ8JU";

// Cổng nghe lén IPN từ VNPAY
app.get('/vnpay-ipn', async (req, res) => {
    let vnp_Params = req.query;
    let secureHash = vnp_Params['vnp_SecureHash'];

    // Xóa chữ ký ra khỏi data để chuẩn bị băm lại kiểm tra
    delete vnp_Params['vnp_SecureHash'];
    delete vnp_Params['vnp_SecureHashType'];

    // Thuật toán sắp xếp A-Z (Bắt buộc của VNPAY)
    vnp_Params = sortObject(vnp_Params);

    // Tạo chữ ký từ Data VNPAY gửi về
    let signData = require('querystring').stringify(vnp_Params, { encode: false });
    let hmac = crypto.createHmac("sha512", VNPAY_SECRET);
    let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");

    // BẮT ĐẦU ĐỐI CHIẾU
    if (secureHash === signed) {
        let orderInfo = vnp_Params['vnp_OrderInfo']; // Trả về dạng: VIP_hocha
        let responseCode = vnp_Params['vnp_ResponseCode'];

        if (responseCode === '00') {
            // Lấy ra đúng cái username
            let username = orderInfo.split('_')[1]; 
            
            console.log(`[TING TING] Tiền đã vào tài khoản!`);
            console.log(`👉 Chuẩn bị buff VIP cho sếp: ${username}`);

            // TODO: Kết nối Firebase Admin để update isPremium = true ở đây

            // Phải trả về mã 00 này thì VNPAY mới biết mình đã nhận được tin nhắn
            res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
        } else {
            console.log('Giao dịch thất bại hoặc bị hủy!');
            res.status(200).json({ RspCode: '00', Message: 'Success' });
        }
    } else {
        console.log('Phát hiện có đứa giả mạo VNPAY gọi API!');
        res.status(200).json({ RspCode: '97', Message: 'Fail checksum' });
    }
});

function sortObject(obj) {
    let sorted = {};
    let str = [];
    let key;
    for (key in obj){
        if (obj.hasOwnProperty(key)) { str.push(encodeURIComponent(key)); }
    }
    str.sort();
    for (key = 0; key < str.length; key++) {
        sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
    }
    return sorted;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Monica IPN đang chạy trên cổng ${PORT}`);

});
