# Pulse: one image = .NET 11 API + the Angular dashboard + the tracker script.
# Built on the Mac for the Pi: docker buildx build --platform linux/arm64 -t pulse:latest .

FROM node:26-alpine AS web
RUN npm install -g corepack@0.36.0 && corepack enable
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM mcr.microsoft.com/dotnet/sdk:11.0 AS api
WORKDIR /src
COPY global.json Directory.Build.props ./
COPY src/Pulse.Api/Pulse.Api.csproj src/Pulse.Api/
RUN dotnet restore src/Pulse.Api/Pulse.Api.csproj
COPY src/ src/
COPY tracker/script.js tracker/
RUN dotnet publish src/Pulse.Api/Pulse.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:11.0
WORKDIR /app
COPY --from=api /app ./
COPY --from=web /web/dist/browser ./wwwroot/
ENV ASPNETCORE_HTTP_PORTS=3000 \
    MALLOC_ARENA_MAX=2
EXPOSE 3000
USER $APP_UID
ENTRYPOINT ["dotnet", "Pulse.Api.dll"]
