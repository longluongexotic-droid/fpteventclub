# FPT Event Club — The Way We Went

Website FEV bằng HTML/CSS/JavaScript, phục vụ từ `dist/` trên GitHub Pages. Đăng nhập hiện kiểm tra trực tiếp trên trình duyệt, không dùng dịch vụ xác thực bên ngoài.

## Xem trên máy

Chạy `node server.mjs` trong thư mục này, mở http://127.0.0.1:4173. Máy chủ preview chỉ phục vụ `dist/`, không phục vụ mã quản trị hoặc tệp riêng tư.

Khi sửa nguồn: `pnpm install --frozen-lockfile`, `pnpm build`, rồi `pnpm test`. Lệnh build chỉ sao chép danh sách tệp công khai vào `dist/`.

## Nội dung

- `index.html`: nội dung trang chủ, thống kê và liên kết.
- `styles.css`: giao diện tím–đen–đỏ, desktop/mobile, hỗ trợ giảm chuyển động.
- `app.js`: menu, hiệu ứng xuất hiện, thống kê.
- `dang-nhap.html`: đăng nhập thành viên; `tuyen-ban-to-chuc.html`: sự kiện mở tuyển và liên kết đăng ký.
- `member.js`, `member-api.js`, `member.css`: giao diện và kiểm tra đăng nhập tại trình duyệt.
- `member-config.js`: cấu hình công khai cho đăng nhập và danh sách sự kiện. Không đặt mật khẩu nguyên văn hoặc dữ liệu riêng tư trong tệp này.
- `supabase/migrations/`, `scripts/provision-members.mjs` và `docs/member-backend.md`: phương án backend dự phòng, hiện không hoạt động và không được xuất bản trong `dist/`.
- `assets/fev-logo.png`: logo gốc do CLB cung cấp, giữ nguyên màu và độ trong suốt.
- `assets/cover-k22.jpg`: ảnh K22 gốc do CLB cung cấp, hiện thay thế video hero.
- Font Montserrat được phục vụ từ file cục bộ.

Số liệu 14 năm, 450+ thành viên, 220+ sự kiện, 120+ đối tác do chủ CLB cung cấp. Email và Instagram lấy từ cover K22. Chưa có thông tin sự kiện đang tuyển nên danh sách tuyển Ban Tổ chức để trống.

## Đăng nhập đơn giản

Thông tin kiểm tra đăng nhập nằm trong mã công khai; trạng thái đăng nhập chỉ được lưu cục bộ trong trình duyệt. Đây là điều kiện hiển thị giao diện, có thể bị bỏ qua bằng công cụ phát triển, **không bảo vệ dữ liệu riêng tư và không xác thực danh tính thật**. Không dùng mật khẩu cá nhân quan trọng cho cơ chế này.

Khi bổ sung sự kiện, cấu hình `applicationUrl` bằng liên kết HTTPS của biểu mẫu đăng ký. Nút đăng ký yêu cầu đăng nhập trong giao diện rồi mở biểu mẫu ở tab mới; nếu chưa có liên kết, trang thông báo chờ cập nhật. Website không tự lưu đơn, không hiển thị lịch sử đơn và không tuyên bố đã gửi đăng ký. Quyền truy cập và lưu trữ của biểu mẫu do nơi cung cấp biểu mẫu quản lý.

## Thay ảnh hero bằng video

Thay thẻ `img` bên trong `.hero-media` bằng `video` có `autoplay muted loop playsinline`, đặt `poster="./assets/cover-k22.jpg"`. Giữ nguyên `.hero-shade` và chữ để bảo đảm nội dung dễ đọc. Với người dùng chọn giảm chuyển động, hiển thị ảnh poster.

## Xuất bản

Website được cấu hình để tự động triển khai thư mục `dist/` lên GitHub Pages mỗi khi nhánh `main` được cập nhật.

- Repository: `https://github.com/longluongexotic-droid/fpteventclub`
- Website chính: `https://fpteventclub.io.vn/`
- GitHub Pages: `https://longluongexotic-droid.github.io/fpteventclub/`

Canonical, Open Graph, sitemap và file `CNAME` dùng tên miền chính `fpteventclub.io.vn`.

Không đưa ảnh chụp đơn hàng/hoá đơn, mật khẩu nguyên văn hoặc khóa quản trị vào website/Git.
