# Ejemplos Detallados — Principios Karpathy en Forge

Cada ejemplo muestra el anti-patron y la correccion en contexto del Golden Path (Next.js + Supabase + TypeScript).

---

## Ejemplo 1: Piensa Antes de Codificar

### Escenario: "Agrega exportacion de datos de usuario"

**Anti-patron — asumir en silencio:**
```typescript
// Server Action que asume todo
'use server'
export async function exportUserData(userId: string) {
  const { data } = await supabase
    .from('users')
    .select('*')  // Todos los campos? Incluye password hash?
    .eq('id', userId)
  
  // Asume CSV sin preguntar
  const csv = convertToCSV(data)
  // Asume descarga directa sin preguntar
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv' }
  })
}
```

**Correcto — surfacear suposiciones:**
```
Antes de implementar el export, necesito clarificar:

1. Campos: ¿Todos los datos del perfil, o solo nombre/email? 
   ¿Incluir datos de uso (actividad, sesiones)?
2. Formato: ¿CSV, JSON, o PDF? 
3. Entrega: ¿Descarga directa o enviar por email?
4. Privacidad: ¿Hay campos sensibles que excluir (tokens, hashes)?
5. Volumen: ¿Un usuario exporta sus propios datos (GDPR) 
   o un admin exporta multiples usuarios?
```

---

## Ejemplo 2: Simplicidad Primero

### Escenario: "Funcion para calcular descuento"

**Anti-patron — over-engineering:**
```typescript
// discount-strategy.ts
interface DiscountStrategy {
  calculate(amount: number): number
}

class PercentageDiscount implements DiscountStrategy {
  constructor(private percent: number) {}
  calculate(amount: number) { return amount * (1 - this.percent / 100) }
}

class FixedDiscount implements DiscountStrategy {
  constructor(private fixed: number) {}
  calculate(amount: number) { return Math.max(0, amount - this.fixed) }
}

class DiscountFactory {
  static create(type: string, value: number): DiscountStrategy {
    switch(type) {
      case 'percentage': return new PercentageDiscount(value)
      case 'fixed': return new FixedDiscount(value)
      default: throw new Error(`Unknown discount type: ${type}`)
    }
  }
}

// ... 80 lineas para algo que se puede hacer en 3
```

**Correcto — simplicidad:**
```typescript
export function calculateDiscount(amount: number, percent: number): number {
  return amount * (1 - percent / 100)
}
```

Cuando genuinamente necesites multiples tipos de descuento, ENTONCES refactoriza.

---

## Ejemplo 3: Cambios Quirurgicos

### Escenario: "Fix: emails vacios crashean el formulario de registro"

**Anti-patron — drive-by refactoring:**
```typescript
// El dev "arregla" el bug pero tambien:
export async function register(formData: FormData) {
  // 1. Agrego validacion de email (el fix real)
  const email = formData.get("email") as string
  if (!email?.trim()) throw new Error("Email required")  // FIX
  
  // 2. "Mejoro" el regex de email (nadie pidio esto)
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  if (!emailRegex.test(email)) throw new Error("Invalid email")
  
  // 3. Agrego validacion de password (nadie pidio esto)
  const password = formData.get("password") as string
  if (password.length < 12) throw new Error("Weak password")
  
  // 4. Cambio comillas simples a dobles (style drift)
  // 5. Agrego type annotations a funciones existentes
  // 6. Reescribo comentarios en ingles
}
```

**Correcto — solo el fix:**
```typescript
export async function register(formData: FormData) {
  const email = formData.get('email') as string
  if (!email?.trim()) throw new Error('Email required')  // FIX
  
  // ... resto del codigo SIN CAMBIOS
}
```

---

## Ejemplo 4: Ejecucion Orientada a Metas

### Escenario: "Agrega rate limiting a los API routes"

**Anti-patron — todo de golpe:**
```typescript
// Un PR de 300 lineas con Redis, sliding window, per-endpoint config,
// retry headers, y dashboard de metricas — sin verificar nada intermedio
```

**Correcto — incremental con verificacion:**

**Fase 1: Rate limiter basico in-memory**
```typescript
// src/shared/lib/rate-limit.ts
const requests = new Map<string, number[]>()

export function rateLimit(ip: string, limit = 10, windowMs = 60000): boolean {
  const now = Date.now()
  const timestamps = requests.get(ip)?.filter(t => now - t < windowMs) ?? []
  timestamps.push(now)
  requests.set(ip, timestamps)
  return timestamps.length <= limit
}
```
Verificar: crear test, probar con requests rapidos, confirmar que bloquea.

**Fase 2: Aplicar como middleware**
```typescript
// src/app/api/[...]/route.ts
import { rateLimit } from '@/shared/lib/rate-limit'
import { headers } from 'next/headers'

export async function POST(req: Request) {
  const ip = (await headers()).get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }
  // ... logica normal
}
```
Verificar: probar endpoint real, confirmar 429 despues de limite.

**Fase 3: Migrar a Upstash Redis (solo si necesario)**
Solo cuando el rate limiter in-memory no escale (multiples instancias, serverless).

Cada fase tiene criterio de exito verificable antes de avanzar a la siguiente.

---

## Regla de Oro

> "El buen codigo resuelve el problema de hoy de forma simple, 
> no el problema de manana de forma prematura."
> — Derivado de Andrej Karpathy
