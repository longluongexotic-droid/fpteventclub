# FPT Event Club — The Way We Went

Trang chủ FEV, HTML/CSS/JavaScript thuần; không cần cài dependency hoặc build.

## Xem trên máy

Chạy `node server.mjs` trong thư mục này, mở http://127.0.0.1:4173.

## Nội dung

- `index.html`: nội dung trang chủ, thống kê và liên kết.
- `styles.css`: giao diện tím–đen–đỏ, desktop/mobile, hỗ trợ giảm chuyển động.
- `app.js`: menu, hiệu ứng xuất hiện, thống kê.
- `assets/fev-logo.png`: logo gốc do CLB cung cấp, giữ nguyên màu và độ trong suốt.
- `assets/cover-k22.jpg`: ảnh K22 gốc do CLB cung cấp, hiện thay thế video hero.
- Font Montserrat được phục vụ từ file cục bộ.

Số liệu 14 năm, 450+ thành viên, 220+ sự kiện, 120+ đối tác do chủ CLB cung cấp. Email và Instagram lấy từ cover K22. Chưa có dữ liệu xác thực về thời gian tuyển nên các nút dẫn tới Fanpage, không hiển thị trạng thái đang tuyển.

## Thay ảnh hero bằng video

Thay thẻ `img` bên trong `.hero-media` bằng `video` có `autoplay muted loop playsinline`, đặt `poster="./assets/cover-k22.jpg"`. Giữ nguyên `.hero-shade` và chữ để bảo đảm nội dung dễ đọc. Với người dùng chọn giảm chuyển động, hiển thị ảnh poster.

## Xuất bản

Website được cấu hình để tự động triển khai thư mục `dist/` lên GitHub Pages mỗi khi nhánh `main` được cập nhật.

- Repository: `https://github.com/longluongexotic-droid/fpteventclub`
- Website chính: `https://fpteventclub.io.vn/`
- GitHub Pages: `https://longluongexotic-droid.github.io/fpteventclub/`

Canonical, Open Graph, sitemap và file `CNAME` dùng tên miền chính `fpteventclub.io.vn`.

Không đưa ảnh chụp đơn hàng/hoá đơn hay dữ liệu tài khoản vào website. Trang chủ không chứa tracker hoặc biểu mẫu lưu dữ liệu cá nhân.
