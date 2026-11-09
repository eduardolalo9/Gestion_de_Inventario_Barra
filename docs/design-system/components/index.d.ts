// BI UI KIT — tipos como documentación de js/03-ui-kit.js.
// Todas las funciones devuelven una cadena HTML para asignar a innerHTML.
// Todo texto que viene de datos se escapa con escapeHtml(); los parámetros *Html no.

export type Tono = 'ok' | 'warn' | 'info' | 'danger' | 'book' | 'brass' | 'neutral';
export type EstadoClave =
  | 'sincronizado' | 'completada' | 'completado' | 'en_nivel' | 'en_conteo'
  | 'pendiente' | 'cerrado' | 'abandonado' | 'contabilizado' | 'corte_mes'
  | 'cierra_semana' | 'bajo' | 'advertencia' | 'limitado' | 'conflicto';
export interface EstadoDef { texto: string; tono: Tono; vivo: boolean; }

export interface BadgeProps { estado: EstadoClave | EstadoDef; opciones?: { tono?: Tono; texto?: string }; }
export interface CifraProps { valor: number | null; opciones?: { decimales?: number; tono?: Exclude<Tono, 'neutral'>; sufijo?: string }; }
export interface MonoProps { nombre: string; grupo?: string; }
export interface MeterProps { hecho: number; total: number; opciones?: { segmentos?: number; tono?: 'ok' | 'info' }; }
export interface ButtonProps {
  texto: string;
  opciones?: { variante?: 'primario' | 'secundario' | 'fantasma' | 'peligro' | 'book'; accion?: string; id?: string; onclick?: string; aria?: string; icono?: string; ancho?: 'completo'; deshabilitado?: boolean };
}
export interface CardProps { titulo?: string; etiqueta?: string; badge?: string; cuerpo?: string; pie?: string; tono?: 'book'; acento?: boolean; id?: string; }
export interface RowProps {
  mono?: string; nombre?: string; nombreHtml?: string; meta?: string;
  cifra?: number | string | null; decimales?: number; sufijo?: string; tono?: Tono;
  estado?: EstadoClave; activa?: boolean; onclick?: string; accion?: string; id?: string;
}
export interface KpiProps { valor: number | string; total?: number | string | null; etiqueta?: string; opciones?: { tono?: 'brass' | 'danger' | 'warn' }; }
export interface FieldProps { id?: string; etiqueta?: string; valor?: string | number; tipo?: string; placeholder?: string; sufijo?: string; ayuda?: string; numerico?: boolean; oninput?: string; deshabilitado?: boolean; }
export interface StepperProps { id?: string; valor?: number | string; accionMas?: string; accionMenos?: string; etiqueta?: string; }
export interface SeccionProps { titulo: string; derecha?: string; }

export declare const UI: {
  ESTADOS: Record<EstadoClave, EstadoDef>;
  badge(estado: BadgeProps['estado'], opciones?: BadgeProps['opciones']): string;
  cifra(valor: CifraProps['valor'], opciones?: CifraProps['opciones']): string;
  mono(nombre: string, grupo?: string): string;
  meter(hecho: number, total: number, opciones?: MeterProps['opciones']): string;
  btn(texto: string, opciones?: ButtonProps['opciones']): string;
  card(o: CardProps): string;
  row(o: RowProps): string;
  kpi(valor: KpiProps['valor'], total?: KpiProps['total'], etiqueta?: string, opciones?: KpiProps['opciones']): string;
  field(o: FieldProps): string;
  stepper(o: StepperProps): string;
  seccion(titulo: string, derecha?: string): string;
};
