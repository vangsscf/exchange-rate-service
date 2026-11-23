import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ObjectSchema } from 'joi';

export class JoiValidationPipe<T> implements PipeTransform<unknown, T> {
    constructor(private readonly schema: ObjectSchema<T>) {}

    transform(input: unknown): T {
        const { value, error } = this.schema.validate(input, { abortEarly: false });
        if (error) {
            throw new BadRequestException(error.details.map(detail => detail.message));
        }

        return value;
    }
}

