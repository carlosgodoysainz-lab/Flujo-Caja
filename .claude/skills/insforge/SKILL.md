---
name: insforge
description: |
  Todo lo relacionado con InsForge BaaS: crear tablas, migraciones, RLS, queries, CRUD,
  auth, storage, real-time, Model Gateway (AI multi-provider), y operaciones de datos.
  Alternativa agents-first a Supabase — misma base Postgres, capa MCP optimizada para agentes.
  Activar cuando el proyecto usa InsForge como backend (NEXT_PUBLIC_INSFORGE_URL en .env).
allowed-tools: Bash(curl *) Bash(export *) Bash(grep *) Read, Write, Edit, Grep
metadata:
  author: forge
  version: "1.0"
---

# InsForge — Backend Agents-First

Postgres + Auth + Storage + Real-time + Model Gateway. Optimizado para que los agentes operen el backend con menos tokens y mayor precisión.

> **¿Cuándo usar InsForge vs Supabase?**
> InsForge: vibe-coding intensivo, self-hosting simple (Docker Compose), o si necesitas Model Gateway multi-provider sin wiring externo.
> Supabase: equipos con DX humana intensiva, ecosystem maduro, SLAs enterprise.

---

## Setup Inicial

### Variables de entorno (`.env.local`)

```bash
NEXT_PUBLIC_INSFORGE_URL=https://tu-proyecto.insforge.dev
NEXT_PUBLIC_INSFORGE_ANON_KEY=tu_anon_key
INSFORGE_SERVICE_KEY=tu_service_key   # Solo server-side, nunca exponer
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### MCP Config (`.mcp.json`)

InsForge usa OAuth — no requiere tokens locales. Solo añadir al mcp.json:

```json
{
  "mcpServers": {
    "insforge": {
      "type": "http",
      "url": "https://mcp.insforge.dev/mcp"
    }
  }
}
```

Autenticar después: `claude /mcp` → seleccionar "insforge" → "Authenticate"

### SDK Client (`src/lib/insforge/client.ts`)

```typescript
import { createClient } from '@insforge/sdk'

export function createBrowserClient() {
  return createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
  })
}
```

### SDK Server (`src/lib/insforge/server.ts`)

```typescript
import { createClient } from '@insforge/sdk'
import { cookies } from 'next/headers'

export async function createServerClient() {
  const cookieStore = await cookies()

  return createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options)
        })
      },
    },
  })
}
```

---

## MCP: Explorar y Operar

Con InsForge MCP conectado, el agente tiene acceso al backend completo. El MCP devuelve contexto estructurado — schema, config, storage — desde un único source of truth.

```
fetch-docs                     -- Carga instrucciones de InsForge en contexto
list-projects                  -- Ver proyectos disponibles
get-project-schema             -- Obtener schema completo de la BD
run-sql                        -- Ejecutar SQL (DDL y DML)
list-tables                    -- Ver tablas existentes
deploy-function                -- Desplegar edge function
```

---

## Database — CRUD Patterns

> **CRITICO**: InsForge inserts requieren formato array `[{...}]`, no objeto `{...}`.

### Setup: Crear tabla con RLS

```sql
-- Via MCP run-sql:

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id);
```

### SDK — CRUD Completo

```typescript
import { createBrowserClient } from '@/lib/insforge/client'

const insforge = createBrowserClient()

// SELECT con filtros
const { data, error } = await insforge.db
  .from('profiles')
  .select('id, email, full_name')
  .eq('id', userId)
  .single()

// INSERT — SIEMPRE array
const { data, error } = await insforge.db
  .from('posts')
  .insert([{ title: 'Hello', user_id: userId }])

// UPDATE
const { data, error } = await insforge.db
  .from('profiles')
  .update({ full_name: 'Carlos' })
  .eq('id', userId)

// DELETE
const { error } = await insforge.db
  .from('posts')
  .delete()
  .eq('id', postId)

// RPC (funciones Postgres)
const { data } = await insforge.db.rpc('get_user_stats', { user_id: userId })
```

### Filtros disponibles

| Método | Significado |
|--------|-------------|
| `.eq('col', val)` | Igual |
| `.neq('col', val)` | No igual |
| `.gt('col', val)` / `.gte` | Mayor / mayor-igual |
| `.lt('col', val)` / `.lte` | Menor / menor-igual |
| `.like('col', '%pat%')` / `.ilike` | Patrón (case-sensitive / insensitive) |
| `.in('col', [a, b])` | En lista |
| `.is('col', null)` | Null check |
| `.order('col', { ascending: false })` | Ordenar |
| `.limit(10).offset(20)` | Paginación |

---

## Auth — Email/Password + OAuth

### Login / Signup (Server Actions)

```typescript
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/insforge/server'

export async function login(formData: FormData) {
  const insforge = await createServerClient()

  const { error } = await insforge.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(formData: FormData) {
  const insforge = await createServerClient()

  const { error } = await insforge.auth.signUp({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/check-email')
}

export async function signout() {
  const insforge = await createServerClient()
  await insforge.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
```

### Obtener usuario (server-side)

```typescript
// En Server Component o Server Action — SIEMPRE getUser(), nunca getSession()
const insforge = await createServerClient()
const { data: { user } } = await insforge.auth.getUser()
```

### Hook cliente (browser)

```typescript
'use client'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/insforge/client'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const insforge = createBrowserClient()

    insforge.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
    })

    const { data: { subscription } } = insforge.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { user, loading }
}
```

---

## Storage — Archivos

```typescript
const insforge = createBrowserClient()

// Upload
const { data, error } = await insforge.storage
  .from('avatars')
  .upload(`${userId}/avatar.png`, file, {
    contentType: 'image/png',
    upsert: true,
  })

// URL pública
const { data } = insforge.storage
  .from('avatars')
  .getPublicUrl(`${userId}/avatar.png`)

// URL firmada (privada, expira)
const { data } = await insforge.storage
  .from('documents')
  .createSignedUrl(`${userId}/doc.pdf`, 3600) // 1 hora

// Delete
const { error } = await insforge.storage
  .from('avatars')
  .remove([`${userId}/avatar.png`])
```

### Crear bucket (via MCP run-sql o dashboard)

```sql
-- Bucket público para avatares
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

-- RLS en storage
CREATE POLICY "upload_own_avatar" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
```

---

## Real-time — Subscriptions

InsForge usa channels + SQL triggers. Tres pasos:

### 1. Crear tabla de channels

```sql
CREATE TABLE realtime_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 2. Trigger para publicar eventos

```sql
CREATE OR REPLACE FUNCTION notify_order_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'order:' || NEW.id::text,
    row_to_json(NEW)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_order_change
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION notify_order_change();
```

### 3. Subscribe en el cliente

```typescript
const insforge = createBrowserClient()

const channel = insforge.realtime
  .channel(`order:${orderId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
    console.log('Order changed:', payload)
  })
  .subscribe()

// Cleanup
return () => insforge.realtime.removeChannel(channel)
```

---

## Model Gateway — AI Multi-Provider

**Exclusivo de InsForge.** Acceso unificado a OpenAI, Anthropic, Gemini, y Grok con billing centralizado. No requiere configurar OpenRouter por separado.

```typescript
import { createBrowserClient } from '@/lib/insforge/client'

const insforge = createBrowserClient()

// Chat completion
const response = await insforge.ai.chat({
  model: 'gpt-4o',           // o 'claude-opus-4-6', 'gemini-2.0-flash', 'grok-3'
  messages: [
    { role: 'system', content: 'Eres un asistente.' },
    { role: 'user', content: 'Hola!' },
  ],
  temperature: 0.7,
})

// El historial de conversación se guarda automáticamente
// en la BD — no necesitas manejarlo manualmente

// Embeddings
const { data } = await insforge.ai.embeddings({
  model: 'text-embedding-3-small',
  input: 'texto a vectorizar',
})
```

> Si ya tienes OpenRouter configurado en el proyecto, sigue usando Vercel AI SDK. El Model Gateway de InsForge es una alternativa, no un reemplazo obligatorio.

---

## Equivalencias con Supabase

| Supabase | InsForge | Notas |
|----------|----------|-------|
| `@supabase/supabase-js` | `@insforge/sdk` | Package diferente |
| `@supabase/ssr` | Incluido en `@insforge/sdk` | No instalar por separado |
| `createServerClient` de `@supabase/ssr` | `createServerClient` de `@/lib/insforge/server` | Mismo patrón |
| `supabase.from('t').insert({})` | `insforge.db.from('t').insert([{}])` | **Array obligatorio en insert** |
| `supabase.auth.getUser()` | `insforge.auth.getUser()` | Idéntico |
| `supabase.storage.from('b')` | `insforge.storage.from('b')` | Idéntico |
| MCP `apply_migration` | MCP `run-sql` | Diferente nombre |
| MCP `list_tables` | MCP `list-tables` | Kebab-case |
| `NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_INSFORGE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_INSFORGE_ANON_KEY` | |

---

## Principios

1. **RLS Siempre**: Toda tabla con datos de usuario requiere RLS habilitado
2. **Insert en Array**: `insert([{...}])` — nunca `insert({...})`
3. **getUser() en servidor**: Nunca `getSession()` — usa `getUser()` para validar auth
4. **MCP fetch-docs primero**: Al empezar trabajo en InsForge, cargar instrucciones actualizadas
5. **Autenticar MCP manualmente**: `claude /mcp` → insforge → Authenticate (OAuth browser)
6. **NUNCA fabricar datos**: Si un query falla, reportarlo — nunca inventar resultados
7. **Service Key solo en servidor**: `INSFORGE_SERVICE_KEY` nunca en cliente ni en chat
8. **Model Gateway es opcional**: Si ya hay OpenRouter, no migrar — solo usar si hay razón

## Flujo de Trabajo

```
Setup:
  MCP fetch-docs > list-tables > diseñar schema > run-sql (DDL) > RLS > test

Datos (via SDK):
  createServerClient/createBrowserClient > CRUD > verificar resultado

AI (Model Gateway):
  insforge.ai.chat > modelo a elegir > historial auto-guardado
```
