// Danh sách công cụ trong bộ. Thêm tool mới: tạo thư mục tools/<id>/ (copy từ tools/_template)
// rồi thêm 1 dòng vào đây. Icon lấy tên từ https://fonts.google.com/icons (bộ Material Symbols).
window.TOOLS = [
  {
    id: 'redirect',
    name: 'Kiểm tra Redirect',
    icon: 'alt_route',
    desc: 'Mở một link nhiều lần, ghi lại từng link nó đi qua và chỉ ra sub3, sub4, Sub_id, affiliate_id, utm_content nằm ở đâu.',
    tags: ['Link', 'Affiliate'],
    path: 'tools/redirect/index.html',
  },
];
