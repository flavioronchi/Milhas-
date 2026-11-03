# Milhas

App pessoal que procura os melhores resgates com milhas (**Smiles**, **LATAM Pass** e **Azul**)
nas rotas que você escolher. Funciona como app no iPhone (PWA) e custa **R$ 0**:

- **App:** site estático em `web/`, publicado no GitHub Pages.
- **Busca:** `python -m collector`, rodando no GitHub Actions (ou no seu computador).
- **Dados:** `web/data/results.json`, gerado pela busca e lido pelo app.
- **Alertas:** Telegram (próxima etapa).

```
config/config.json ──► collector (Smiles / LATAM / Azul) ──► web/data/results.json ──► app no iPhone
```

## Status

| Etapa | Situação |
|---|---|
| 1. App web + dados de exemplo | ✅ |
| 2. Coletor Smiles | ⏳ |
| 3. Alertas no Telegram | ⏳ |
| 4. Coletores Azul e LATAM Pass | ⏳ |

## Busca aos poucos

Para não ser bloqueado, cada rodada faz só um lote de buscas (programa × trecho × data) e guarda
o progresso em `data/state.json`. Quando todas as datas de todas as rotas forem buscadas, a
**varredura fica completa** e o app mostra o ranking final; em seguida começa outra varredura para
manter os preços atualizados. O tamanho do lote e a pausa entre buscas ficam em `pacing`, no config.

## Configurar rotas e alertas

Edite `config/config.json` (dá para fazer pelo próprio iPhone, no site do GitHub):

```json
{
  "id": "sp-florida",
  "name": "São Paulo → Flórida",
  "origin": ["GRU", "VCP"],
  "destination": ["MIA", "MCO"],
  "date_from": "2027-07-01",
  "date_to": "2027-12-31",
  "cabins": ["economy", "business"],
  "passengers": 1,
  "alerts": [{ "cabin": "economy", "max_miles": 35000 }]
}
```

- `origin` / `destination`: um aeroporto (`"GRU"`) ou vários (`["GRU", "VCP"]`); todas as combinações são buscadas.
- `cabins`: `economy`, `premium`, `business`, `first`.
- `alerts`: cada regra pode ter `cabin`, `program` (`smiles`/`latam`/`azul`), `max_miles` e `max_cost_brl`.
- `milheiro_brl`: quanto valem 1.000 milhas de cada programa, usado no ranking por custo em R$
  (custo = milhas ÷ 1000 × milheiro + taxas). No app, em **Ajustes**, você pode sobrescrever esses valores.

## Publicar o app (uma vez só)

1. Deixe o repositório **público** (Settings → General → Danger Zone → Change visibility).
2. Settings → **Pages** → Source: **GitHub Actions**.
3. Actions → **Publicar app (GitHub Pages)** → Run workflow.
4. Abra `https://flavioronchi.github.io/Milhas-/` no Safari do iPhone →
   **Compartilhar → Adicionar à Tela de Início**.

## Rodar localmente

```bash
python -m collector               # gera web/data/results.json
python -m http.server -d web 8000 # abra http://localhost:8000
python scripts/make_icons.py      # (re)gera os ícones
```

## Avisos

Preços são por pessoa, só ida, e mudam rápido: confirme sempre no site do programa antes de emitir.
Consultas automatizadas podem violar os termos de uso dos programas; o coletor faz poucas buscas,
só para uso pessoal.
