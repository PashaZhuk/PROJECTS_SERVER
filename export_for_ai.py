import os
from pathlib import Path

OUTPUT = "project_for_ai.md"

# Что игнорируем
IGNORE_DIRS = {"node_modules", ".git", ".vscode", "dist", "build", ".vite", "coverage"}
IGNORE_FILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock",
    ".map", ".log", "tsconfig.tsbuildinfo"
}

# Разрешенные расширения
ALLOWED_EXT = {".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".json", 
               ".md", ".html", ".yaml", ".yml", ".toml", ".env.example"}

MAX_SIZE = 500_000  # 500 KB

def is_text_file(path):
    try:
        with open(path, "rb") as f:
            return b"\x00" not in f.read(8192)
    except:
        return False

def main():
    # Текущая директория (где лежит скрипт)
    root = Path(".").resolve()
    print(f"📁 Корень проекта: {root}")
    
    files_found = 0
    total_size = 0
    
    with open(OUTPUT, "w", encoding="utf-8") as out:
        out.write(f"# 📦 Экспорт проекта: {root.name}\n\n")
        
        #  Структура
        out.write("## 🌳 Структура проекта\n```\n")
        for dirpath, dirnames, filenames in os.walk(root):
            # Пропускаем игнорируемые папки
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
            dirnames.sort()
            
            # Вычисляем уровень вложенности
            rel_path = Path(dirpath).relative_to(root)
            level = len(rel_path.parts) if str(rel_path) != "." else 0
            
            indent = "  " * level
            folder_name = dirpath if level == 0 else os.path.basename(dirpath)
            out.write(f"{indent}📁 {folder_name}/\n")
            
            # Файлы
            for fname in sorted(filenames):
                if fname.startswith("."):
                    continue
                out.write(f"{indent}  📄 {fname}\n")
        out.write("```\n\n")
        
        # 📝 Содержимое
        out.write("## 📝 Содержимое файлов\n\n")
        out.write("> 💡 **Для ИИ:** Это React + TypeScript + Vite приложение. ")
        out.write("Анализируй: типы, API вызовы (ky), состояние (store), роутинг (pages), компоненты.\n\n")
        
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
            dirnames.sort()
            
            for fname in sorted(filenames):
                filepath = Path(dirpath) / fname
                rel_path = filepath.relative_to(root)
                
                # Пропускаем игнорируемые файлы
                if fname in IGNORE_FILES:
                    continue
                if any(fname.startswith(x) for x in [".env", "package-lock"]):
                    continue
                
                # Проверяем расширение
                ext = fname.lower().split(".")[-1]
                full_ext = "." + ext
                if full_ext not in ALLOWED_EXT and fname not in [
                    "tsconfig.json", "tsconfig.app.json", "tsconfig.node.json", 
                    "vite.config.ts", "eslint.config.js", ".gitignore"
                ]:
                    continue
                
                # Проверяем размер
                try:
                    size = filepath.stat().st_size
                    if size > MAX_SIZE:
                        out.write(f"### 📄 `{rel_path}`\n⚠️ Пропущено (> {size/1024:.0f} KB)\n\n")
                        continue
                except:
                    continue
                
                # Проверяем текстовый файл
                if not is_text_file(filepath):
                    continue
                
                # Читаем и записываем
                try:
                    content = filepath.read_text(encoding="utf-8", errors="ignore").strip()
                    files_found += 1
                    total_size += size
                    
                    # Определяем язык для подсветки
                    lang_map = {
                        "ts": "typescript", "tsx": "typescript", "js": "javascript",
                        "jsx": "javascript", "css": "css", "json": "json",
                        "md": "markdown", "html": "html", "yaml": "yaml",
                        "yml": "yaml", "toml": "toml"
                    }
                    lang = lang_map.get(ext, "")
                    
                    out.write(f"### 📄 `{rel_path}`\n")
                    out.write(f"```{lang}\n{content}\n```\n\n")
                    
                except Exception as e:
                    out.write(f"### 📄 `{rel_path}`\n❌ Ошибка чтения: {e}\n\n")
    
    print(f"✅ Готово: {OUTPUT}")
    print(f"📊 Файлов экспортировано: {files_found}")
    print(f"📏 Размер: {total_size/1024:.1f} KB")

if __name__ == "__main__":
    main()