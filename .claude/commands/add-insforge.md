# /add-insforge — Setup InsForge BaaS

Configura InsForge como backend del proyecto: MCP, SDK, env vars, cliente SSR, y auth completa.

**NO preguntas. Ejecutas el setup completo.**

---

## Contexto Técnico

**InsForge SDK:**
- `@insforge/sdk` — reemplaza `@supabase/supabase-js` + `@supabase/ssr`
- `createClient({ baseUrl, anonKey, cookies? })` — mismo patrón que Supabase SSR
- Inserts requieren array: `insert([{...}])` nunca `insert({...})`
- Auth: `getUser()` en servidor, `onAuthStateChange` en cliente

**MCP InsForge:**
- HTTP transport, OAuth browser — sin tokens locales
- `run-sql` para DDL/DML, `list-tables` para explorar schema
- Se autentica con `claude /mcp` después del setup

---

## Paso 1: Configurar MCP

Verificar si `.mcp.json` existe. Si no, crear desde `example.mcp.json`.

Añadir/reemplazar entrada InsForge en `.mcp.json`:

```json
"insforge": {
  "type": "http",
  "url": "https://mcp.insforge.dev/mcp"
}
```

Si había entrada `supabase` en la sección core, moverla a `_comment_baas_alternative` o eliminarla — **no tener ambas activas**.

---

## Paso 2: Actualizar `package.json`

Añadir `@insforge/sdk` a dependencies. Si existen `@supabase/supabase-js` y `@supabase/ssr`, marcarlos como "a remover" — el usuario decide si desinstalar manualmente.

```json
{
  "dependencies": {
    "@insforge/sdk": "latest"
  }
}
```

Ejecutar: `npm install @insforge/sdk`

---

## Paso 3: Archivos a Crear

### `src/lib/insforge/client.ts`

```typescript
import { createClient } from '@insforge/sdk'

export function createBrowserClient() {
  return createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
  })
}
```

### `src/lib/insforge/server.ts`

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

### `proxy.ts` (root)

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/insforge/proxy'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

### `src/lib/insforge/proxy.ts`

```typescript
import { createClient } from '@insforge/sdk'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let insforgeResponse = NextResponse.next({ request })

  const insforge = createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!,
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        insforgeResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          insforgeResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  const { data: { user } } = await insforge.auth.getUser()

  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard')
  const isAuthRoute =
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/signup')

  if (isProtectedRoute && !user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return insforgeResponse
}
```

### `src/types/database.ts`

```typescript
export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}
```

### `src/actions/auth.ts`

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

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(formData: FormData) {
  const insforge = await createServerClient()

  const { error } = await insforge.auth.signUp({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  redirect('/check-email')
}

export async function signout() {
  const insforge = await createServerClient()
  await insforge.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

export async function resetPassword(formData: FormData) {
  const insforge = await createServerClient()
  const email = formData.get('email') as string

  const { error } = await insforge.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/update-password`,
  })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}

export async function updatePassword(formData: FormData) {
  const insforge = await createServerClient()
  const password = formData.get('password') as string

  const { error } = await insforge.auth.updateUser({ password })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function updateProfile(formData: FormData) {
  const insforge = await createServerClient()
  const { data: { user } } = await insforge.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { error } = await insforge.db
    .from('profiles')
    .update({
      full_name: formData.get('full_name') as string,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  return { success: true }
}
```

### `src/hooks/useAuth.ts`

```typescript
'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/insforge/client'
import type { Profile } from '@/types/database'

export function useAuth() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const insforge = createBrowserClient()

    async function getProfile(userId: string) {
      const { data } = await insforge.db
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      setProfile(data)
    }

    insforge.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      if (user) getProfile(user.id)
      setLoading(false)
    })

    const { data: { subscription } } = insforge.auth.onAuthStateChange(
      (_event, session) => {
        const currentUser = session?.user ?? null
        setUser(currentUser)
        if (currentUser) {
          getProfile(currentUser.id)
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { user, profile, loading }
}
```

---

## Paso 4: Actualizar `.env.local.example`

Añadir o reemplazar variables:

```bash
# InsForge BaaS
NEXT_PUBLIC_INSFORGE_URL=https://tu-proyecto.insforge.dev
NEXT_PUBLIC_INSFORGE_ANON_KEY=tu_anon_key_aqui
INSFORGE_SERVICE_KEY=tu_service_key_aqui
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

---

## Paso 5: Crear tabla profiles via MCP

Una vez autenticado el MCP, ejecutar:

```sql
-- Tabla profiles
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Trigger: crear perfil automáticamente al signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

> Si el MCP aún no está autenticado, omitir este paso y notificarlo en el mensaje final.

---

## Flujo de Ejecución

1. Añadir InsForge a `.mcp.json`
2. Instalar `@insforge/sdk` con npm install
3. Crear TODOS los archivos de código listados
4. Actualizar `.env.local.example`
5. Ejecutar migración de profiles (si MCP autenticado)
6. Mostrar mensaje final

---

## Mensaje Final

```
InsForge configurado!

Backend agents-first listo:
- MCP InsForge en .mcp.json (HTTP transport)
- SDK @insforge/sdk instalado
- src/lib/insforge/ (client + server + proxy)
- Auth completa (login, signup, signout, reset password)
- Hook useAuth() para cliente
- Tabla profiles con RLS

Pasos finales:

1. Autenticar MCP InsForge:
   claude /mcp → seleccionar "insforge" → "Authenticate"
   (abre browser para OAuth — sin tokens locales)

2. Configurar .env.local con tus credenciales:
   Ve a insforge.dev → tu proyecto → Settings → API

   NEXT_PUBLIC_INSFORGE_URL=https://tu-proyecto.insforge.dev
   NEXT_PUBLIC_INSFORGE_ANON_KEY=eyJhbG...
   INSFORGE_SERVICE_KEY=sk_...   (solo server-side)

3. npm run dev

Listo para probar en /login

Skill disponible: leer .claude/skills/insforge/SKILL.md para patrones de DB, Storage, Real-time y Model Gateway.
```
