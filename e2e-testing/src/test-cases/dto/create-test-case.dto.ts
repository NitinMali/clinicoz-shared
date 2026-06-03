import {
  IsNotEmpty,
  IsString,
  IsUrl,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { validateTestInstructions } from './validate-test-instructions';

/**
 * Custom validator that ensures instructions contain at least one
 * non-whitespace character and do not exceed 5000 characters.
 */
@ValidatorConstraint({ name: 'isValidTestInstructions', async: false })
export class IsValidTestInstructionsConstraint implements ValidatorConstraintInterface {
  validate(value: string, _args: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    return validateTestInstructions(value).valid;
  }

  defaultMessage(args: ValidationArguments): string {
    if (typeof args.value !== 'string') {
      return 'instructions must be a string';
    }
    const result = validateTestInstructions(args.value);
    if (!result.valid) {
      return result.reason;
    }
    return 'instructions validation failed';
  }
}

export class CreateTestCaseDto {
  @IsString()
  @IsNotEmpty({ message: 'name must not be empty' })
  name!: string;

  @IsString()
  @Validate(IsValidTestInstructionsConstraint)
  instructions!: string;

  @IsString()
  @IsNotEmpty({ message: 'targetUrl must not be empty' })
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'targetUrl must be a valid URL' },
  )
  targetUrl!: string;
}
