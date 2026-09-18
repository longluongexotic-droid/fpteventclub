# FPT Event Club — The Way We Went

Website FEV bằng HTML/CSS/JavaScript; trang công khai được phục vụ từ `dist/`. Khu vực thành viên dùng Supabase Auth và PostgreSQL để xác thực và kiểm tra quyền đăng ký.

## Xem trên máy

Chạy `node server.mjs` trong thư mục này, mở http://127.0.0.1:4173. Máy chủ preview chỉ phục vụ `dist/`, không phục vụ mã quản trị hoặc tệp riêng tư.

Khi sửa nguồn: `pnpm install --frozen-lockfile`, `pnpm build`, rồi `pnpm test`. Lệnh build sao chép danh sách tệp công khai và SDK Supabase đã khóa phiên bản vào `dist/`.

## Nội dung

- `index.html`: nội dung trang chủ, thống kê và liên kết.
- `styles.css`: giao diện tím–đen–đỏ, desktop/mobile, hỗ trợ giảm chuyển động.
- `app.js`: menu, hiệu ứng xuất hiện, thống kê.
- `dang-nhap.html`: đăng nhập thành viên; `tuyen-ban-to-chuc.html`: sự kiện mở tuyển và đơn của thành viên.
- `member.js`, `member-api.js`, `member.css`: giao diện và kết nối Supabase; không lưu mật khẩu trong mã nguồn.
- `member-config.js`: URL dự án và publishable key công khai. Để trống sẽ khóa chức năng đăng nhập, không mô phỏng tài khoản.
- `supabase/migrations/` và `scripts/provision-members.mjs`: schema, quyền dữ liệu và công cụ cấp tài khoản. Xem `docs/member-backend.md` trước khi kích hoạt backend.
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

Không đưa ảnh chụp đơn hàng/hoá đơn, mật khẩu hoặc khóa quản trị vào website/Git. Đơn đăng ký chỉ được ghi lên Supabase sau khi xác thực tài khoản thành viên; mỗi thành viên chỉ đọc được đơn của mình.
