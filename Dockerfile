# Deploy em VPS via Docker / EasyPanel. Nenhuma chave entra na imagem: configure tudo em Environment (runtime).
# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY são lidas em RUNTIME pelo servidor e repassadas
# ao navegador, então o build funciona mesmo sem elas. Os ARGs abaixo são opcionais.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
# Sem "ENV X=$ARG": se o argumento não for passado, o valor NÃO pode virar string vazia
# (o Next gravaria "" no bundle e ignoraria as variáveis de runtime).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Variável vazia/ausente é descartada, para o Next não gravar "" no bundle.
RUN [ -n "$NEXT_PUBLIC_SUPABASE_URL" ] || unset NEXT_PUBLIC_SUPABASE_URL; \
    [ -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" ] || unset NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; \
    npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
