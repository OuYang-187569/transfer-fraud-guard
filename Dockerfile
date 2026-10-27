# 生产环境镜像：Nginx 托管静态站点
FROM nginx:1.27-alpine

# 站点配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 静态资源（src 目录即完整前端）
COPY src/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
