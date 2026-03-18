/**
 * Screen Reader Announcer for Candy World
 * Provides accessible announcements for game events
 * 
 * WCAG 2.1 Compliance:
 * - 4.1.3 Status Messages (AA) - Announces important changes
 * - 2.4.3 Focus Order (A) - Manages focus for screen readers
 * - 2.4.7 Focus Visible (AA) - Visual focus indicators
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type AnnouncementPriority = 'polite' | 'assertive' | 'off';

export interface Announcement {
  message: string;
  priority: AnnouncementPriority;
  timestamp: number;
  id: string;
}

export interface AnnouncerOptions {
  maxQueueSize: number;
  defaultPriority: AnnouncementPriority;
  clearDelay: number;
  enableLogging: boolean;
}

// ============================================================================
// Game Event Types
// ============================================================================

export type GameEventType = 
  | 'discovery'
  | 'collection'
  | 'combat'
  | 'environment'
  | 'quest'
  | 'inventory'
  | 'status'
  | 'dialogue'
  | 'warning'
  | 'achievement';

export interface GameEvent {
  type: GameEventType;
  message: string;
  priority?: AnnouncementPriority;
  context?: Record<string, unknown>;
}

// ============================================================================
// Announcer Templates
// ============================================================================

const eventTemplates: Record<GameEventType, (context: Record<string, unknown>) => string> = {
  discovery: (ctx) => {
    const item = ctx.item as string || 'something';
    const location = ctx.location as string;
    return location 
      ? `Discovered: ${item} at ${location}` 
      : `Discovered: ${item}`;
  },
  collection: (ctx) => {
    const item = ctx.item as string || 'item';
    const count = ctx.count as number || 1;
    const total = ctx.total as number;
    if (total !== undefined) {
      return `Collected ${count} ${item}. Total: ${total}`;
    }
    return count > 1 
      ? `Collected ${count} ${item}s` 
      : `Collected ${item}`;
  },
  combat: (ctx) => {
    const action = ctx.action as string || 'attacked';
    const target = ctx.target as string || 'enemy';
    const damage = ctx.damage as number;
    if (damage !== undefined) {
      return `${action} ${target} for ${damage} damage`;
    }
    return `${action} ${target}`;
  },
  environment: (ctx) => {
    const event = ctx.event as string || 'environment changed';
    return event;
  },
  quest: (ctx) => {
    const action = ctx.action as string || 'updated';
    const quest = ctx.quest as string || 'quest';
    return `Quest ${action}: ${quest}`;
  },
  inventory: (ctx) => {
    const action = ctx.action as string || 'changed';
    const item = ctx.item as string || 'item';
    return `Inventory ${action}: ${item}`;
  },
  status: (ctx) => {
    const status = ctx.status as string || 'status changed';
    return status;
  },
  dialogue: (ctx) => {
    const speaker = ctx.speaker as string;
    const text = ctx.text as string || '';
    return speaker 
      ? `${speaker} says: ${text}` 
      : text;
  },
  warning: (ctx) => {
    const warning = ctx.warning as string || 'Warning';
    return `Warning: ${warning}`;
  },
  achievement: (ctx) => {
    const achievement = ctx.achievement as string || 'Achievement unlocked';
    return `Achievement unlocked: ${achievement}`;
  },
};

// ============================================================================
// Announcer Class
// ============================================================================

export class Announcer {
  private container: HTMLElement | null = null;
  private politeRegion: HTMLElement | null = null;
  private assertiveRegion: HTMLElement | null = null;
  private options: AnnouncerOptions;
  private queue: Announcement[] = [];
  private processing = false;
  private currentAnnouncement: Announcement | null = null;

  constructor(options: Partial<AnnouncerOptions> = {}) {
    this.options = {
      maxQueueSize: 100,
      defaultPriority: 'polite',
      clearDelay: 1000,
      enableLogging: false,
      ...options,
    };

    this.init();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private init(): void {
    this.createAnnouncerElements();
    this.setupEventListeners();
  }

  private createAnnouncerElements(): void {
    // Check if announcer already exists
    if (document.getElementById('a11y-announcer-container')) {
      this.container = document.getElementById('a11y-announcer-container');
      this.politeRegion = document.getElementById('a11y-announcer-polite');
      this.assertiveRegion = document.getElementById('a11y-announcer-assertive');
      return;
    }

    // Create container (visually hidden but accessible to screen readers)
    this.container = document.createElement('div');
    this.container.id = 'a11y-announcer-container';
    this.container.setAttribute('aria-live', 'off');
    this.container.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;

    // Create polite announcement region (waits for user to finish)
    this.politeRegion = document.createElement('div');
    this.politeRegion.id = 'a11y-announcer-polite';
    this.politeRegion.setAttribute('aria-live', 'polite');
    this.politeRegion.setAttribute('aria-atomic', 'true');
    this.politeRegion.setAttribute('aria-relevant', 'additions text');

    // Create assertive announcement region (interrupts immediately)
    this.assertiveRegion = document.createElement('div');
    this.assertiveRegion.id = 'a11y-announcer-assertive';
    this.assertiveRegion.setAttribute('aria-live', 'assertive');
    this.assertiveRegion.setAttribute('aria-atomic', 'true');
    this.assertiveRegion.setAttribute('aria-relevant', 'additions text');

    this.container.appendChild(this.politeRegion);
    this.container.appendChild(this.assertiveRegion);
    document.body.appendChild(this.container);
  }

  private setupEventListeners(): void {
    // Listen for custom announcement events
    document.addEventListener('a11y-announce', ((event: CustomEvent) => {
      const { message, priority } = event.detail;
      this.announce(message, priority);
    }) as EventListener);

    // Listen for game events
    document.addEventListener('game-event', ((event: CustomEvent) => {
      this.handleGameEvent(event.detail);
    }) as EventListener);
  }

  // ============================================================================
  // Announcement Methods
  // ============================================================================

  announce(message: string, priority: AnnouncementPriority = 'polite'): void {
    const announcement: Announcement = {
      message,
      priority,
      timestamp: Date.now(),
      id: this.generateId(),
    };

    if (priority === 'assertive') {
      // Interrupt current announcement
      this.clearQueue();
      this.processAnnouncement(announcement);
    } else {
      this.queueAnnouncement(announcement);
    }

    if (this.options.enableLogging) {
      console.log(`[Announcer] ${priority}: ${message}`);
    }
  }

  announceNow(message: string): void {
    this.announce(message, 'assertive');
  }

  announcePolite(message: string): void {
    this.announce(message, 'polite');
  }

  // ============================================================================
  // Game Event Handling
  // ============================================================================

  handleGameEvent(event: GameEvent): void {
    const template = eventTemplates[event.type];
    if (!template) {
      // Use raw message if no template
      this.announce(event.message, event.priority || 'polite');
      return;
    }

    const message = template(event.context || {});
    this.announce(message, event.priority || this.getDefaultPriority(event.type));
  }

  announceDiscovery(item: string, location?: string): void {
    this.handleGameEvent({
      type: 'discovery',
      message: '',
      context: { item, location },
    });
  }

  announceCollection(item: string, count: number, total?: number): void {
    this.handleGameEvent({
      type: 'collection',
      message: '',
      context: { item, count, total },
    });
  }

  announceCombat(action: string, target: string, damage?: number): void {
    this.handleGameEvent({
      type: 'combat',
      message: '',
      priority: 'assertive',
      context: { action, target, damage },
    });
  }

  announceEnvironment(event: string): void {
    this.handleGameEvent({
      type: 'environment',
      message: '',
      context: { event },
    });
  }

  announceQuest(action: string, quest: string): void {
    this.handleGameEvent({
      type: 'quest',
      message: '',
      context: { action, quest },
    });
  }

  announceInventory(action: string, item: string): void {
    this.handleGameEvent({
      type: 'inventory',
      message: '',
      context: { action, item },
    });
  }

  announceStatus(status: string): void {
    this.handleGameEvent({
      type: 'status',
      message: '',
      context: { status },
    });
  }

  announceDialogue(speaker: string, text: string): void {
    this.handleGameEvent({
      type: 'dialogue',
      message: '',
      context: { speaker, text },
    });
  }

  announceWarning(warning: string): void {
    this.handleGameEvent({
      type: 'warning',
      message: '',
      priority: 'assertive',
      context: { warning },
    });
  }

  announceAchievement(achievement: string): void {
    this.handleGameEvent({
      type: 'achievement',
      message: '',
      context: { achievement },
    });
  }

  // ============================================================================
  // Queue Management
  // ============================================================================

  private queueAnnouncement(announcement: Announcement): void {
    if (this.queue.length >= this.options.maxQueueSize) {
      // Remove oldest polite announcement
      const oldestIndex = this.queue.findIndex(a => a.priority === 'polite');
      if (oldestIndex >= 0) {
        this.queue.splice(oldestIndex, 1);
      }
    }

    this.queue.push(announcement);
    this.processQueue();
  }

  private clearQueue(): void {
    this.queue = [];
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const announcement = this.queue.shift();
      if (announcement) {
        await this.processAnnouncement(announcement);
      }
    }

    this.processing = false;
  }

  private async processAnnouncement(announcement: Announcement): Promise<void> {
    this.currentAnnouncement = announcement;

    const region = announcement.priority === 'assertive' 
      ? this.assertiveRegion 
      : this.politeRegion;

    if (!region) return;

    // Clear previous content
    region.textContent = '';

    // Small delay to ensure screen reader detects the change
    await this.delay(100);

    // Set new content
    region.textContent = announcement.message;

    // Wait for announcement to be read (estimated)
    const readTime = this.estimateReadTime(announcement.message);
    await this.delay(readTime + this.options.clearDelay);

    // Clear after reading
    region.textContent = '';
    this.currentAnnouncement = null;
  }

  private estimateReadTime(message: string): number {
    // Average reading speed: 150-200 words per minute
    // ~3-4 characters per word on average
    const words = message.length / 4;
    const wordsPerSecond = 3; // Conservative for screen readers
    return Math.max(1000, (words / wordsPerSecond) * 1000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================================
  // Priority Helpers
  // ============================================================================

  private getDefaultPriority(eventType: GameEventType): AnnouncementPriority {
    switch (eventType) {
      case 'warning':
      case 'combat':
        return 'assertive';
      case 'discovery':
      case 'collection':
      case 'achievement':
        return 'polite';
      default:
        return 'polite';
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private generateId(): string {
    return `a11y-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getCurrentAnnouncement(): Announcement | null {
    return this.currentAnnouncement;
  }

  // ============================================================================
  // Focus Management
  // ============================================================================

  /**
   * Sets focus to a specific element and announces it
   */
  focusAndAnnounce(element: HTMLElement, description?: string): void {
    element.focus();
    
    if (description) {
      this.announce(`${description}, focused`, 'polite');
    } else {
      const ariaLabel = element.getAttribute('aria-label');
      const text = element.textContent || '';
      this.announce(`${ariaLabel || text}, focused`, 'polite');
    }
  }

  /**
   * Announces the current menu context
   */
  announceMenuContext(menuName: string, itemCount: number): void {
    this.announce(`${menuName} menu, ${itemCount} items`, 'polite');
  }

  /**
   * Announces navigation within a menu
   */
  announceNavigation(currentItem: string, position: number, total: number): void {
    this.announce(`${currentItem}, ${position} of ${total}`, 'polite');
  }

  /**
   * Announces a value change (for sliders, etc.)
   */
  announceValueChange(control: string, value: string | number, min?: number, max?: number): void {
    let message = `${control}: ${value}`;
    if (min !== undefined && max !== undefined) {
      message += `, ${Math.round(((Number(value) - min) / (max - min)) * 100)}%`;
    }
    this.announce(message, 'polite');
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  destroy(): void {
    this.clearQueue();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.politeRegion = null;
    this.assertiveRegion = null;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let announcerInstance: Announcer | null = null;

export function getAnnouncer(): Announcer {
  if (!announcerInstance) {
    announcerInstance = new Announcer();
  }
  return announcerInstance;
}

export function initAnnouncer(options?: Partial<AnnouncerOptions>): Announcer {
  if (!announcerInstance) {
    announcerInstance = new Announcer(options);
  }
  return announcerInstance;
}

// ============================================================================
// Helper Functions
// ============================================================================

export function announce(message: string, priority: AnnouncementPriority = 'polite'): void {
  getAnnouncer().announce(message, priority);
}

export function announceNow(message: string): void {
  getAnnouncer().announceNow(message);
}

export function announcePolite(message: string): void {
  getAnnouncer().announcePolite(message);
}

export function announceDiscovery(item: string, location?: string): void {
  getAnnouncer().announceDiscovery(item, location);
}

export function announceCollection(item: string, count: number, total?: number): void {
  getAnnouncer().announceCollection(item, count, total);
}

export function announceCombat(action: string, target: string, damage?: number): void {
  getAnnouncer().announceCombat(action, target, damage);
}

export function announceEnvironment(event: string): void {
  getAnnouncer().announceEnvironment(event);
}

export function announceQuest(action: string, quest: string): void {
  getAnnouncer().announceQuest(action, quest);
}

export function announceInventory(action: string, item: string): void {
  getAnnouncer().announceInventory(action, item);
}

export function announceStatus(status: string): void {
  getAnnouncer().announceStatus(status);
}

export function announceDialogue(speaker: string, text: string): void {
  getAnnouncer().announceDialogue(speaker, text);
}

export function announceWarning(warning: string): void {
  getAnnouncer().announceWarning(warning);
}

export function announceAchievement(achievement: string): void {
  getAnnouncer().announceAchievement(achievement);
}

export function announceValueChange(control: string, value: string | number, min?: number, max?: number): void {
  getAnnouncer().announceValueChange(control, value, min, max);
}

// Re-export types
export type { Announcement, AnnouncementPriority, GameEvent, GameEventType };
