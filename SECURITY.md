# Bảo mật

## Báo lỗ hổng

Nếu bạn phát hiện lỗ hổng bảo mật, **đừng mở issue công khai**. Hãy gửi báo cáo riêng qua tab **Security → Report a vulnerability** của repo (GitHub Private Vulnerability Reporting). Mô tả lỗi, cách tái hiện và mức ảnh hưởng.

## Quyền của extension

| Quyền | Dùng để |
|---|---|
| `webRequest`, `webNavigation` | Ghi lại các bước chuyển hướng của link đang kiểm tra |
| `tabs` | Mở/đóng tab kiểm tra trong cửa sổ riêng; chuyển tới tab bộ công cụ đã mở |
| `cookies` | Tuỳ chọn *Xoá cookie của các link đã đi qua* (mặc định tắt) |
| `declarativeNetRequestWithHostAccess` | Đổi User-Agent cho riêng tab kiểm tra khi chọn "Điện thoại" |
| `host_permissions: <all_urls>` | Link cần kiểm tra có thể thuộc bất kỳ trang nào |

Extension chỉ theo dõi các tab do chính nó mở để kiểm tra, không đọc các tab khác. Extension không gửi dữ liệu đi đâu; kết quả chỉ nằm trong trình duyệt của bạn cho tới khi bạn tự xuất CSV. Font và icon được tải từ Google Fonts.
