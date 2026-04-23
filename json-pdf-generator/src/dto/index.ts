import {
  IsString,
  IsArray,
  IsBoolean,
  ArrayMinSize,
  IsOptional,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ParagraphItemDto {
  @IsIn(['paragraph'])
  type: 'paragraph';

  @IsString()
  text: string;

  @IsOptional()
  @IsIn(['left', 'center', 'right', 'justify'])
  align?: 'left' | 'center' | 'right' | 'justify';
}

export class TableItemDto {
  @IsIn(['table'])
  type: 'table';

  @IsArray()
  headers: string[];

  @IsArray()
  rows: string[][];
}

export class BulletListItemDto {
  @IsIn(['bulletList'])
  type: 'bulletList';

  @IsArray()
  @ArrayMinSize(1)
  items: string[];
}

export class GridColumnDto {
  @IsOptional()
  @IsString()
  width?: string;

  @IsOptional()
  @IsIn(['left', 'center', 'right'])
  align?: 'left' | 'center' | 'right';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => Object)
  content: (ParagraphItemDto | TableItemDto | BulletListItemDto)[];
}

export class GridItemDto {
  @IsIn(['grid'])
  type: 'grid';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GridColumnDto)
  columns: GridColumnDto[];

  @IsOptional()
  @IsString()
  gap?: string;
}

export class PdfSectionDto {
  @IsString()
  title: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => Object)
  content: (ParagraphItemDto | TableItemDto | BulletListItemDto | GridItemDto)[];
}

export class PdfHeaderDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  showOnAllPages?: boolean;
}

export class PdfFooterDto {
  @IsString()
  text: string;
}

export class PdfLayoutDto {
  @IsOptional()
  @IsString()
  headerHeight?: string;

  @IsOptional()
  @IsString()
  footerHeight?: string;

  @IsOptional()
  @IsString()
  bodyPaddingTop?: string;

  @IsOptional()
  @IsString()
  bodyPaddingBottom?: string;

  @IsOptional()
  @IsString()
  marginLeft?: string;

  @IsOptional()
  @IsString()
  marginRight?: string;
}

export class PdfDocumentDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PdfHeaderDto)
  header?: PdfHeaderDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PdfSectionDto)
  body: PdfSectionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PdfFooterDto)
  footer?: PdfFooterDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PdfLayoutDto)
  layout?: PdfLayoutDto;
}

export class PdfOutputConfigDto {
  @IsOptional()
  @IsString()
  s3Bucket?: string;

  @IsOptional()
  @IsString()
  s3Folder?: string;
}

export class PdfGenerateRequestDto {
  @IsString()
  template: string;

  data: Record<string, any>;

  @IsOptional()
  @ValidateNested()
  @Type(() => PdfOutputConfigDto)
  output?: PdfOutputConfigDto;
}
