export class Money {
  private constructor(private readonly cents: number) {}

  static fromCents(cents: number): Money {
    return new Money(cents)
  }

  static fromEuros(euros: number): Money {
    return new Money(Math.round(euros * 100))
  }

  getCents(): number {
    return this.cents
  }

  getEuros(): number {
    return this.cents / 100
  }

  isLessThan(other: Money): boolean {
    return this.cents < other.cents
  }

  isGreaterThan(other: Money): boolean {
    return this.cents > other.cents
  }

  equals(other: Money): boolean {
    return this.cents === other.cents
  }

  add(other: Money): Money {
    return new Money(this.cents + other.cents)
  }

  subtract(other: Money): Money {
    return new Money(this.cents - other.cents)
  }

  minus(other: Money): Money {
    return this.subtract(other)
  }

  multiply(factor: number): Money {
    return new Money(Math.round(this.cents * factor))
  }

  toString(): string {
    return `${this.getEuros().toFixed(2)}€`
  }
}

