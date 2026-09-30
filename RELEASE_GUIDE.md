# Guia de Releases

> **Fonte upstream**: `psx8/psx8.github.io` (commit `ea85cfe4`) sincronizado em 2026-09-29.
> O sistema monitora automaticamente novos commits nesse repositório e alerta quando houver atualização.


## Estrutura de arquivos

```
as/
├── index.html          ← interface principal (não editar a cada release)
├── style.css
├── sw.js               ← service worker (offline)
├── manifest.json       ← ÚNICO ARQUIVO EDITADO a cada nova release
├── config.json         ← fontes autorizadas e opções globais
└── js/
    ├── update-system.js
    └── app.js
```

---

## Como publicar uma nova release

### 1. Prepare o arquivo no GitHub

1. Compile/exporte o payload (ex.: `payload.bin`).
2. Calcule o SHA-256:

```powershell
# Windows
Get-FileHash .\payload.bin -Algorithm SHA256
```

```bash
# Linux / macOS
sha256sum payload.bin
```

3. Crie uma release no GitHub com:
   - Tag: `v1.1.0`
   - Título: `v1.1.0`
   - Body (obrigatório para firmware e hash):

```
firmwares: 13.52

sha256(payload.bin): <HASH_AQUI>

## Changelog
- Descrição da mudança
```

4. Faça o upload do `payload.bin` como asset da release.

---

### 2. Atualize o manifest.json

Adicione a nova entrada em `releases` e atualize `latest`:

```json
{
  "schemaVersion": 1,
  "latest": "1.1.0",
  "releases": [
    {
      "version": "1.1.0",
      "date": "2026-10-01",
      "changelog": "Correção de bug X.",
      "firmwares": ["13.52"],
      "source": "https://github.com/SEU_USUARIO/SEU_REPOSITORIO/releases/tag/v1.1.0",
      "files": [
        {
          "name": "payload.bin",
          "description": "Payload principal",
          "firmware": "13.52",
          "url": "https://github.com/SEU_USUARIO/SEU_REPOSITORIO/releases/download/v1.1.0/payload.bin",
          "sha256": "HASH_SHA256_CALCULADO_ACIMA",
          "size": 0
        }
      ]
    },
    {
      "version": "1.0.0",
      "date": "2026-09-29",
      ...
    }
  ],
  "firmwareCompatibility": [
    {
      "firmware": "13.52",
      "supported": true,
      "version": "1.1.0",
      "notes": ""
    }
  ]
}
```

3. Faça o commit e push do `manifest.json` no seu site estático (GitHub Pages, Netlify etc.).

> Isso é suficiente. O site detectará a nova versão automaticamente na próxima visita ou verificação periódica.

---

## Como configurar a fonte autorizada (config.json)

### Usando GitHub Releases (recomendado)

```json
{
  "sources": [
    {
      "id": "github",
      "type": "github-releases",
      "enabled": true,
      "owner": "SEU_USUARIO_GITHUB",
      "repo": "SEU_REPOSITORIO",
      "priority": 1
    }
  ],
  "pinnedVersion": null,
  "checkIntervalMinutes": 60,
  "allowPrerelease": false
}
```

### Usando manifest.json hospedado

```json
{
  "sources": [
    {
      "id": "manifest",
      "type": "manifest-url",
      "enabled": true,
      "url": "https://SEU_DOMINIO/manifest.json",
      "priority": 1
    }
  ]
}
```

---

## Como testar antes de disponibilizar

### Teste local com servidor HTTP

```bash
# Python 3
python -m http.server 8080

# Node.js (npx)
npx serve .
```

Acesse `http://localhost:8080` no navegador.

### Fluxo de teste completo

1. **Versão limpa**: abra DevTools → Application → IndexedDB → limpe o banco `update-system`. Recarregue.
   - Espera: "Nenhuma versão instalada localmente."

2. **Instalação inicial**: clique em "Atualizar".
   - Espera: barra de progresso, SHA-256 verificado, "Versão X instalada com sucesso."

3. **Simule uma atualização**: no `manifest.json` local troque `latest` para `2.0.0` e adicione uma release fictícia. Recarregue.
   - Espera: banner amarelo "Nova versão disponível: 2.0.0".

4. **Rollback**: instale a v2.0.0 (mesmo que falhe), depois clique "Reverter versão anterior".
   - Espera: log "Revertido para 1.0.0".

5. **Modo offline**: desative a rede em DevTools → Network → Offline. Recarregue.
   - Espera: badge "Offline", versão instalada continua visível.

6. **SHA-256 inválido**: coloque um hash errado no `manifest.json` e tente instalar.
   - Espera: erro "Verificação SHA-256 falhou", rollback automático.

7. **Fixar versão**: clique "Fixar versão atual" e troque `latest` para `2.0.0`.
   - Espera: sem banner de atualização — versão fixada.

---

## Adicionar novo firmware compatível

No `manifest.json`, adicione em `firmwareCompatibility`:

```json
{
  "firmware": "14.00",
  "supported": true,
  "version": "1.1.0",
  "notes": "Requer payload v2"
}
```

**Importante**: não presuma compatibilidade. Declare explicitamente somente após validação.

---

## Fixar uma versão específica para usuários com problemas

O usuário pode clicar em "Fixar versão atual" na interface. Para forçar globalmente pelo `config.json`:

```json
{
  "pinnedVersion": "1.0.0"
}
```

Isso faz o sistema ignorar versões mais novas e usar sempre a 1.0.0.
