import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['plugin/**', 'public/**', 'node_modules/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json', './src/configpanel/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  prettier
)
