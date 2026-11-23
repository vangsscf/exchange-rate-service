import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

export class JsonMessageException extends HttpException {
    constructor(message: string, status: number) {
        super(message, status);
    }
}

@Catch(JsonMessageException)
export class JsonMessageFilter implements ExceptionFilter<JsonMessageException> {
    catch(exception: JsonMessageException, host: ArgumentsHost): void {
        host.switchToHttp().getResponse<Response>()
            .status(exception.getStatus())
            .json(exception.message);
    }
}

