// data.js - nguồn dữ liệu tách riêng cho trang index
// Có thể thay thế động bằng fetch JSON trong tương lai.

export const slides = [
    {
        id: 1,
        bg: 'assets/bannerweb-1.png',
        title: 'Trở thành khách hàng ưu tiên',
        desc: 'Trải nghiệm hệ sinh thái đặc quyền ưu tiên từ VIB',
        link: '#khachhanguutien',
        cta: 'Xem chi tiết'
    },
    {
        id: 2,
        bg: 'assets/bannerweb-2.png',
        title: 'Ưu đãi hoàn tiền hấp dẫn',
        desc: 'Hoàn tiền đến 30% cho giao dịch đủ điều kiện',
        link: '#hoantien',
        cta: 'Tìm hiểu'
    },
    {
        id: 3,
        bg: 'assets/Bannerweb-3.png',
        title: 'Nâng hạn mức nhanh chóng',
        desc: 'Xử lý yêu cầu nâng hạn mức thẻ trong 24H',
        link: '#nanghanmuc',
        cta: 'Đăng ký'
    },
    {
        id: 4,
        bg: 'assets/Bannerweb-4.png',
        title: 'Quản lý tài chính thông minh',
        desc: 'Công cụ hỗ trợ lập kế hoạch chi tiêu hiệu quả',
        link: '#congcutaichinh',
        cta: 'Khám phá'
    }
];

export const promotions = [
    { title: 'Giảm đến 4,6 triệu', desc: 'Áp dụng cho sản phẩm tín dụng được chọn.', link: '#uudai1' },
    { title: 'Giảm đến 50%', desc: 'Nạp tiền di động trả trước trên MyVIB.', link: '#uudai2' },
    { title: 'Hoàn tiền đến 30%', desc: 'Tối đa 3 triệu đồng giao dịch online.', link: '#uudai3' },
    { title: 'Ưu đãi bảo hiểm', desc: 'Bảo vệ toàn diện cho gia đình bạn.', link: '#uudai4' }
];

export const cardServices = [
    'Mở Thẻ Tín Dụng VIB',
    'Nâng Hạn Mức Thẻ Tín Dụng VIB',
    'Hủy Thẻ Tín Dụng VIB 24H'
];

export const tabs = [
    { key: 'the', label: 'Thẻ', items: ['Mở Thẻ Tín Dụng VIB', 'Nâng Hạn Mức Thẻ', 'Hủy Thẻ 24H'] },
    { key: 'tai-khoan', label: 'Tài khoản', content: 'Tài khoản thanh toán linh hoạt.' },
    { key: 'tiet-kiem', label: 'Tiết kiệm', content: 'Lãi suất hấp dẫn, gửi linh hoạt.' },
    { key: 'vay', label: 'Vay', content: 'Giải pháp vay tiêu dùng đa dạng.' },
    { key: 'bao-hiem', label: 'Bảo hiểm', content: 'Sản phẩm bảo hiểm an tâm.' }
];

export const news = [
    { title: 'Tăng trưởng bền vững', desc: 'VIB công bố kết quả kinh doanh quý mới.', link: '#news1' },
    { title: 'Chuyển đổi số', desc: 'Gia tăng trải nghiệm người dùng MyVIB.', link: '#news2' },
    { title: 'CSR & Cộng đồng', desc: 'Hoạt động thiện nguyện đồng hành.', link: '#news3' }
];

// Hàm dựng động (chưa gắn vào index để tránh đột biến lớn ngay)
export function hydratePromotions(root = document.querySelector('.promo-grid')) {
    if (!root) return;
    root.innerHTML = promotions.map(p => `
    <article class="promo-card"><h3>${p.title}</h3><p>${p.desc}</p><a href="${p.link}" class="text-link">Chi tiết</a></article>`).join('');
}

export function hydrateCardServices(root = document.querySelector('.card-services ul')) {
    if (!root) return;
    root.innerHTML = cardServices.map(item => `<li style="background:#fff;padding:14px 16px;border:1px solid #e2e6ea;border-radius:14px;">${item}</li>`).join('');
}

export function hydrateNews(root = document.querySelector('.news-grid')) {
    if (!root) return;
    root.innerHTML = news.map(n => `
    <article class="news-item"><h3>${n.title}</h3><p>${n.desc}</p><a href="${n.link}" class="text-link">Đọc thêm</a></article>`).join('');
}

// Gợi ý: Có thể gọi các hydrate* sau khi DOMContentLoaded trong main script nếu muốn kích hoạt dữ liệu động.
