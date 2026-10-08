# Unit Economics Calculator

Калькулятор юнит-экономики: CAC, LTV, ROMI, маржинальность и окупаемость привлечения клиентов.

## Стек

- React 19 + Vite + TypeScript
- Tailwind CSS (utility-классы)
- lucide-react (иконки)
- recharts (графики)
- html2canvas + jspdf (экспорт в PDF)
- HashRouter (совместимость с GitHub Pages)
- localStorage (хранение данных)

## Команды

```bash
npm install      # установка зависимостей
npm run dev      # dev-сервер
npm run build    # production-сборка
npm run preview  # предпросмотр сборки
npm run lint     # линтер
```

## Деплой

GitHub Pages разворачивается автоматически через GitHub Actions (`.github/workflows/deploy.yml`) при пуше в `main`. В настройках репозитория выберите **Settings → Pages → Source: GitHub Actions**.
